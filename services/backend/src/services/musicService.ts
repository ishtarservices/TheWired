import { createHash } from "crypto";
import { createWriteStream, existsSync } from "fs";
import { mkdir, unlink, rename, rm } from "fs/promises";
import { join, resolve, extname } from "path";
import { Readable } from "stream";
import { eq, desc, sql, and } from "drizzle-orm";
import { db } from "../db/connection.js";
import { musicUploads } from "../db/schema/music.js";
import { blobs, blobOwners } from "../db/schema/blobs.js";
import { nanoid } from "../lib/id.js";
import { config } from "../config.js";
import { mimeToExt } from "../lib/mimeToExt.js";
import { getTranscodeQueue } from "../lib/queue.js";

const BLOB_DIR = resolve(process.cwd(), config.blobDir);
const MAX_AUDIO_SIZE = config.maxBlobSize;
const MAX_COVER_SIZE = 10 * 1024 * 1024; // 10MB

const ALLOWED_AUDIO_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/ogg",
  "audio/flac",
  "audio/wav",
  "audio/x-wav",
  "audio/aac",
  "audio/mp4",
  "audio/webm",
  "audio/aiff",
  "audio/x-aiff",
]);

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

/** Escape a string for use in Meilisearch filter expressions to prevent injection */
function escapeMsFilter(value: string): string {
  // Remove double quotes and backslashes which could break out of filter expressions
  return value.replace(/[\\"]/g, "");
}

async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true });
}

export const musicService = {
  async uploadAudio(
    file: { filename: string; mimetype: string; file: NodeJS.ReadableStream },
    pubkey: string,
    clientDuration?: number,
  ) {
    if (!ALLOWED_AUDIO_TYPES.has(file.mimetype)) {
      throw new Error(`Invalid audio type: ${file.mimetype}`);
    }

    await ensureDir(BLOB_DIR);

    // Stream to a temp file first (we can't name by hash until we know it)
    const tempId = nanoid(16);
    const ext = mimeToExt(file.mimetype) || extname(file.filename) || ".mp3";
    const tempPath = join(BLOB_DIR, `.tmp_${tempId}${ext}`);

    let size = 0;
    const writeStream = createWriteStream(tempPath);
    const hash = createHash("sha256");
    const readable = file.file instanceof Readable ? file.file : Readable.from(file.file as AsyncIterable<Buffer>);

    for await (const chunk of readable) {
      size += (chunk as Buffer).length;
      if (size > MAX_AUDIO_SIZE) {
        writeStream.destroy();
        await unlink(tempPath).catch(() => {});
        throw new Error("File too large (max 100MB)");
      }
      hash.update(chunk as Buffer);
      writeStream.write(chunk);
    }
    await new Promise<void>((resolve, reject) => {
      writeStream.end(() => resolve());
      writeStream.on("error", reject);
    });

    const sha256 = hash.digest("hex");
    const storedName = `${sha256}${ext}`;
    const storagePath = join(BLOB_DIR, storedName);

    // Dedup: if blob already exists on disk, skip the rename
    if (existsSync(storagePath)) {
      await unlink(tempPath).catch(() => {});
    } else {
      await rename(tempPath, storagePath);
    }

    const url = `${config.publicUrl}/${sha256}${ext}`;
    const uploaded = Math.floor(Date.now() / 1000);

    // Insert into blobs table (dedup-safe)
    await db.insert(blobs).values({ sha256, size, type: file.mimetype, uploaded }).onConflictDoNothing();
    await db.insert(blobOwners).values({ sha256, pubkey }).onConflictDoNothing();

    // Insert into music_uploads for music-specific metadata
    const id = nanoid(16);
    await db.insert(musicUploads).values({
      id,
      pubkey,
      originalFilename: file.filename,
      storagePath,
      url,
      sha256,
      mimeType: file.mimetype,
      fileSize: size,
      duration: clientDuration ?? null,
    });

    // Enqueue transcode job if the pipeline is enabled. `jobId: sha256` dedupes:
    // re-uploads of the same audio by different users produce one job.
    if (config.transcodeEnqueue) {
      try {
        await getTranscodeQueue().add(
          "transcode",
          { sha256, mimeType: file.mimetype, storagePath },
          { jobId: sha256 },
        );
      } catch (err) {
        console.warn("[transcode] enqueue failed:", (err as Error).message);
      }
    }

    return {
      url,
      sha256,
      size,
      mimeType: file.mimetype,
      duration: clientDuration,
    };
  },

  async uploadCover(
    file: { filename: string; mimetype: string; file: NodeJS.ReadableStream },
    pubkey: string,
  ) {
    if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      throw new Error(`Invalid image type: ${file.mimetype}`);
    }

    await ensureDir(BLOB_DIR);

    const tempId = nanoid(16);
    const ext = mimeToExt(file.mimetype) || extname(file.filename) || ".jpg";
    const tempPath = join(BLOB_DIR, `.tmp_${tempId}${ext}`);

    let size = 0;
    const writeStream = createWriteStream(tempPath);
    const hash = createHash("sha256");
    const readable = file.file instanceof Readable ? file.file : Readable.from(file.file as AsyncIterable<Buffer>);

    for await (const chunk of readable) {
      size += (chunk as Buffer).length;
      if (size > MAX_COVER_SIZE) {
        writeStream.destroy();
        await unlink(tempPath).catch(() => {});
        throw new Error("Image too large (max 10MB)");
      }
      hash.update(chunk as Buffer);
      writeStream.write(chunk);
    }
    await new Promise<void>((resolve, reject) => {
      writeStream.end(() => resolve());
      writeStream.on("error", reject);
    });

    const sha256 = hash.digest("hex");
    const storedName = `${sha256}${ext}`;
    const storagePath = join(BLOB_DIR, storedName);

    if (existsSync(storagePath)) {
      await unlink(tempPath).catch(() => {});
    } else {
      await rename(tempPath, storagePath);
    }

    const url = `${config.publicUrl}/${sha256}${ext}`;
    const uploaded = Math.floor(Date.now() / 1000);

    // Insert into blobs table (covers now tracked in DB)
    await db.insert(blobs).values({ sha256, size, type: file.mimetype, uploaded }).onConflictDoNothing();
    await db.insert(blobOwners).values({ sha256, pubkey }).onConflictDoNothing();

    return { url, sha256 };
  },

  /**
   * Full reindex: scan relay.events (Postgres) for all music events,
   * repopulate Meilisearch tracks/albums indexes, and rebuild Redis counts.
   * This is the recovery path when Meilisearch is out of sync with the relay DB.
   */
  async rebuildCounts() {
    const { getMeilisearchClient } = await import("../lib/meilisearch.js");
    const { getRedis } = await import("../lib/redis.js");
    const ms = getMeilisearchClient();
    const redis = getRedis();

    // Clear stale data
    await redis.del("music:genre_counts", "music:tag_counts", "music:counted_events");

    // Clear stale Meilisearch documents so we don't keep ghosts
    try { await ms.index("tracks").deleteAllDocuments(); } catch { /* index may not exist */ }
    try { await ms.index("albums").deleteAllDocuments(); } catch { /* index may not exist */ }

    const genreCounts = new Map<string, number>();
    const tagCounts = new Map<string, number>();
    const eventIds: string[] = [];
    const BATCH = 200;

    // --- Reindex tracks (kind:31683) from relay.events ---
    let lastId = "";
    while (true) {
      const rows = (await db.execute(
        sql`SELECT id, pubkey, kind, tags, content, created_at, sig
            FROM relay.events
            WHERE kind = 31683 AND id > ${lastId}
            ORDER BY id
            LIMIT ${BATCH}`,
      )) as unknown as { id: string; pubkey: string; kind: number; tags: string[][]; content: string; created_at: number; sig: string }[];

      if (rows.length === 0) break;

      const msDocs = [];
      for (const row of rows) {
        const tags = row.tags;
        const dTag = tags.find((t) => t[0] === "d")?.[1] ?? "";
        const title = tags.find((t) => t[0] === "title")?.[1] ?? "";
        const artist = tags.find((t) => t[0] === "artist")?.[1] ?? "";
        const genre = tags.find((t) => t[0] === "genre")?.[1] ?? "";
        const imageUrl = tags.find((t) => t[0] === "image")?.[1] ?? tags.find((t) => t[0] === "thumb")?.[1] ?? "";
        const visibility = tags.find((t) => t[0] === "visibility")?.[1];
        const hTag = tags.find((t) => t[0] === "h")?.[1];
        const hashtags = tags.filter((t) => t[0] === "t").map((t) => t[1]);
        const isPublic = !visibility || (visibility !== "unlisted" && visibility !== "private" && !hTag);

        // Only index and count public tracks
        if (isPublic) {
          msDocs.push({
            id: row.id,
            addressable_id: `31683:${row.pubkey}:${dTag}`,
            title, artist, genre, image_url: imageUrl, hashtags,
            pubkey: row.pubkey,
            created_at: Number(row.created_at), // PG bigint → JS number
          });

          eventIds.push(row.id);
          if (genre) genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1);
          for (const tag of hashtags) {
            tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
          }
        }
      }

      if (msDocs.length > 0) {
        await ms.index("tracks").addDocuments(msDocs);
      }

      lastId = rows[rows.length - 1].id;
      if (rows.length < BATCH) break;
    }

    // --- Reindex albums (kind:33123) from relay.events ---
    lastId = "";
    while (true) {
      const rows = (await db.execute(
        sql`SELECT id, pubkey, kind, tags, content, created_at, sig
            FROM relay.events
            WHERE kind = 33123 AND id > ${lastId}
            ORDER BY id
            LIMIT ${BATCH}`,
      )) as unknown as { id: string; pubkey: string; kind: number; tags: string[][]; content: string; created_at: number; sig: string }[];

      if (rows.length === 0) break;

      const msDocs = [];
      for (const row of rows) {
        const tags = row.tags;
        const dTag = tags.find((t) => t[0] === "d")?.[1] ?? "";
        const title = tags.find((t) => t[0] === "title")?.[1] ?? "";
        const artist = tags.find((t) => t[0] === "artist")?.[1] ?? "";
        const genre = tags.find((t) => t[0] === "genre")?.[1] ?? "";
        const imageUrl = tags.find((t) => t[0] === "image")?.[1] ?? tags.find((t) => t[0] === "thumb")?.[1] ?? "";
        const visibility = tags.find((t) => t[0] === "visibility")?.[1];
        const hTag = tags.find((t) => t[0] === "h")?.[1];
        const hashtags = tags.filter((t) => t[0] === "t").map((t) => t[1]);
        const isPublic = !visibility || (visibility !== "unlisted" && visibility !== "private" && !hTag);

        // Only index and count public albums
        if (isPublic) {
          msDocs.push({
            id: row.id,
            addressable_id: `33123:${row.pubkey}:${dTag}`,
            title, artist, genre, image_url: imageUrl, hashtags,
            pubkey: row.pubkey,
            created_at: Number(row.created_at), // PG bigint → JS number
          });

          eventIds.push(row.id);
          if (genre) genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1);
          for (const tag of hashtags) {
            tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
          }
        }
      }

      if (msDocs.length > 0) {
        await ms.index("albums").addDocuments(msDocs);
      }

      lastId = rows[rows.length - 1].id;
      if (rows.length < BATCH) break;
    }

    // Write fresh counts to Redis
    const pipeline = redis.pipeline();
    for (const [genre, count] of genreCounts) {
      pipeline.zadd("music:genre_counts", count, genre);
    }
    for (const [tag, count] of tagCounts) {
      pipeline.zadd("music:tag_counts", count, tag);
    }
    if (eventIds.length > 0) {
      pipeline.sadd("music:counted_events", ...eventIds);
    }
    await pipeline.exec();

    return {
      genres: genreCounts.size,
      tags: tagCounts.size,
      tracksAndAlbums: eventIds.length,
    };
  },

  async getGenreCounts() {
    const { getRedis } = await import("../lib/redis.js");
    const redis = getRedis();
    const raw = await redis.zrevrange("music:genre_counts", 0, -1, "WITHSCORES");
    const genres: { genre: string; count: number }[] = [];
    for (let i = 0; i < raw.length; i += 2) {
      genres.push({ genre: raw[i], count: parseInt(raw[i + 1], 10) });
    }
    return genres;
  },

  async getPopularTags(limit = 20) {
    const { getRedis } = await import("../lib/redis.js");
    const redis = getRedis();
    const raw = await redis.zrevrange("music:tag_counts", 0, limit - 1, "WITHSCORES");
    const tags: { tag: string; count: number }[] = [];
    for (let i = 0; i < raw.length; i += 2) {
      tags.push({ tag: raw[i], count: parseInt(raw[i + 1], 10) });
    }
    return tags;
  },

  async browse(params: {
    genre?: string;
    tag?: string;
    sort?: "trending" | "recent" | "plays";
    limit?: number;
    offset?: number;
  }) {
    const { getMeilisearchClient } = await import("../lib/meilisearch.js");
    const { getRedis } = await import("../lib/redis.js");
    const ms = getMeilisearchClient();
    const redis = getRedis();
    const limit = params.limit ?? 20;
    const offset = params.offset ?? 0;

    let eventIds: string[] = [];
    let total = 0;

    if (params.sort === "plays") {
      // Sort by play count: get all matching event IDs from Meilisearch, then rank by Redis play_count
      const filters: string[] = [];
      if (params.genre) filters.push(`genre = "${escapeMsFilter(params.genre)}"`);
      if (params.tag) filters.push(`hashtags = "${escapeMsFilter(params.tag)}"`);

      const results = await ms.index("tracks").search("", {
        filter: filters.length > 0 ? filters.join(" AND ") : undefined,
        limit: 500, // fetch a large pool to sort by plays
      });

      // Extract both eventId and addressableId from hits
      const candidates = results.hits.map((h: Record<string, unknown>) => ({
        eventId: h.id as string,
        addressableId: h.addressable_id as string,
      }));
      total = results.estimatedTotalHits ?? 0;

      if (candidates.length > 0) {
        // Batch-fetch play counts from Redis keyed by addressableId
        const pipeline = redis.pipeline();
        for (const c of candidates) pipeline.get(`play_count:${c.addressableId}`);
        const counts = await pipeline.exec();

        const scored = candidates.map((c, i) => ({
          eventId: c.eventId,
          plays: parseInt((counts?.[i]?.[1] as string) ?? "0", 10),
        }));
        scored.sort((a, b) => b.plays - a.plays);
        eventIds = scored.slice(offset, offset + limit).map((s) => s.eventId);
      }
    } else if (params.sort === "trending") {
      // Use Redis trending sorted sets
      const key = params.genre
        ? `trending:music:tracks:genre:${escapeMsFilter(params.genre).toLowerCase()}`
        : "trending:music:tracks";
      eventIds = await redis.zrevrange(key, offset, offset + limit - 1);
      total = eventIds.length;
    } else {
      // Meilisearch filtered search — "recent" sort
      const filters: string[] = [];
      if (params.genre) filters.push(`genre = "${escapeMsFilter(params.genre)}"`);
      if (params.tag) filters.push(`hashtags = "${escapeMsFilter(params.tag)}"`);

      const results = await ms.index("tracks").search("", {
        filter: filters.length > 0 ? filters.join(" AND ") : undefined,
        sort: ["created_at:desc"],
        limit,
        offset,
      });

      eventIds = results.hits.map((h: Record<string, unknown>) => h.id as string);
      total = results.estimatedTotalHits ?? 0;
    }

    if (eventIds.length === 0) {
      return { tracks: [], total: 0 };
    }

    // Fetch full events from the relay DB so the client can render them
    const idPlaceholders = sql.join(eventIds.map((id) => sql`${id}`), sql`, `);
    const rows = (await db.execute(
      sql`SELECT id, pubkey, kind, tags, content, created_at, sig
          FROM relay.events
          WHERE id IN (${idPlaceholders})`,
    )) as unknown as {
      id: string;
      pubkey: string;
      kind: number;
      tags: string[][];
      content: string;
      created_at: number;
      sig: string;
    }[];

    // Normalize PG bigint → JS number for created_at, preserve order from Meilisearch/Redis
    const normalized = rows.map((r) => ({ ...r, created_at: Number(r.created_at) }));
    const byId = new Map(normalized.map((r) => [r.id, r]));
    const events = eventIds.map((id) => byId.get(id)).filter(Boolean);

    return { tracks: events, total };
  },

  async browseAlbums(params: {
    genre?: string;
    tag?: string;
    sort?: "trending" | "recent" | "plays";
    limit?: number;
    offset?: number;
  }) {
    const { getMeilisearchClient } = await import("../lib/meilisearch.js");
    const { getRedis } = await import("../lib/redis.js");
    const ms = getMeilisearchClient();
    const redis = getRedis();
    const limit = params.limit ?? 20;
    const offset = params.offset ?? 0;

    let eventIds: string[] = [];
    let total = 0;

    if (params.sort === "trending") {
      // Use Redis trending sorted set for albums
      eventIds = await redis.zrevrange("trending:music:albums", offset, offset + limit - 1);
      total = eventIds.length;
    } else {
      const filters: string[] = [];
      if (params.genre) filters.push(`genre = "${escapeMsFilter(params.genre)}"`);
      if (params.tag) filters.push(`hashtags = "${escapeMsFilter(params.tag)}"`);

      const results = await ms.index("albums").search("", {
        filter: filters.length > 0 ? filters.join(" AND ") : undefined,
        sort: ["created_at:desc"],
        limit,
        offset,
      });

      eventIds = results.hits.map((h: Record<string, unknown>) => h.id as string);
      total = results.estimatedTotalHits ?? 0;
    }

    if (eventIds.length === 0) {
      return { albums: [], total: 0 };
    }

    const idPlaceholders = sql.join(eventIds.map((id) => sql`${id}`), sql`, `);
    const rows = (await db.execute(
      sql`SELECT id, pubkey, kind, tags, content, created_at, sig
          FROM relay.events
          WHERE id IN (${idPlaceholders})`,
    )) as unknown as {
      id: string;
      pubkey: string;
      kind: number;
      tags: string[][];
      content: string;
      created_at: number;
      sig: string;
    }[];

    const normalized = rows.map((r) => ({ ...r, created_at: Number(r.created_at) }));
    const byId = new Map(normalized.map((r) => [r.id, r]));
    const events = eventIds.map((id) => byId.get(id)).filter(Boolean);

    return { albums: events, total };
  },

  async recordPlay(addressableId: string, pubkey: string) {
    const { getRedis } = await import("../lib/redis.js");
    const redis = getRedis();

    // Dedup: 30s cooldown per pubkey per addressable event
    const dedupKey = `played:${pubkey}:${addressableId}`;
    const wasSet = await redis.set(dedupKey, "1", "EX", 30, "NX");
    if (!wasSet) return false;

    const today = new Date().toISOString().split("T")[0];

    // Redis writes (fast path for trending)
    const redisPipeline = redis.pipeline();
    redisPipeline.incr(`play_count:${addressableId}`);
    redisPipeline.pfadd(`unique_listeners:${addressableId}`, pubkey);
    const dailyKey = `daily_plays:${addressableId}:${today}`;
    redisPipeline.incr(dailyKey);
    redisPipeline.expire(dailyKey, 90 * 24 * 3600);
    redisPipeline.zadd(`listening_history:${pubkey}`, Math.floor(Date.now() / 1000), addressableId);
    redisPipeline.zremrangebyrank(`listening_history:${pubkey}`, 0, -501);
    await redisPipeline.exec();

    // PostgreSQL writes (durable persistence) — fire-and-forget
    db.execute(
      sql`INSERT INTO app.music_play_daily (addressable_id, date, play_count)
          VALUES (${addressableId}, ${today}::date, 1)
          ON CONFLICT (addressable_id, date)
          DO UPDATE SET play_count = app.music_play_daily.play_count + 1`,
    ).catch((err) => console.error("[music] Failed to persist daily play:", (err as Error).message));

    db.execute(
      sql`INSERT INTO app.music_play_listeners (addressable_id, pubkey)
          VALUES (${addressableId}, ${pubkey})
          ON CONFLICT (addressable_id, pubkey)
          DO UPDATE SET last_played_at = NOW(), play_count = app.music_play_listeners.play_count + 1`,
    ).catch((err) => console.error("[music] Failed to persist listener:", (err as Error).message));

    return true;
  },

  async getInsights(addressableId: string) {
    try {
    // Total plays from PostgreSQL
    const totalRows = (await db.execute(
      sql`SELECT COALESCE(SUM(play_count), 0)::int AS total
          FROM app.music_play_daily
          WHERE addressable_id = ${addressableId}`,
    )) as unknown as { total: number }[];
    const totalPlays = totalRows[0]?.total ?? 0;

    // Unique listeners from PostgreSQL
    const listenerRows = (await db.execute(
      sql`SELECT COUNT(*)::int AS count
          FROM app.music_play_listeners
          WHERE addressable_id = ${addressableId}`,
    )) as unknown as { count: number }[];
    const uniqueListeners = listenerRows[0]?.count ?? 0;

    // Daily plays for last 30 days from PostgreSQL
    const dailyRows = (await db.execute(
      sql`SELECT date::text, play_count
          FROM app.music_play_daily
          WHERE addressable_id = ${addressableId}
            AND date >= CURRENT_DATE - 30
          ORDER BY date`,
    )) as unknown as { date: string; play_count: number }[];

    // Fill in missing days with 0
    const dailyMap = new Map(dailyRows.map((r) => [r.date, r.play_count]));
    const dailyPlays: { date: string; count: number }[] = [];
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split("T")[0];
      dailyPlays.push({ date: dateStr, count: dailyMap.get(dateStr) ?? 0 });
    }

    // Trend: compare last 7 days to previous 7 days
    const last7 = dailyPlays.slice(-7).reduce((s, d) => s + d.count, 0);
    const prev7 = dailyPlays.slice(-14, -7).reduce((s, d) => s + d.count, 0);
    const trend = last7 > prev7 * 1.1 ? "up" as const : last7 < prev7 * 0.9 ? "down" as const : "stable" as const;

    return { totalPlays, uniqueListeners, dailyPlays, trend };
    } catch (err) {
      console.error("[insights] getInsights failed:", (err as Error).message);
      throw err;
    }
  },

  async getArtistSummary(pubkey: string) {
    try {
      const { getMeilisearchClient } = await import("../lib/meilisearch.js");
      const ms = getMeilisearchClient();

      // Find all tracks by this pubkey from Meilisearch (for title/addressableId mapping)
      const results = await ms.index("tracks").search("", {
        filter: `pubkey = "${escapeMsFilter(pubkey)}"`,
        limit: 500,
      });
      if (results.hits.length === 0) {
        return { totalPlays: 0, totalListeners: 0, trackBreakdown: [], trackCount: 0 };
      }

      const trackMap = new Map<string, string>();
      for (const hit of results.hits) {
        trackMap.set(hit.addressable_id as string, hit.title as string);
      }
      const addrIds = [...trackMap.keys()];

      // Batch query: total plays per track from PostgreSQL
      const addrArray = sql`ARRAY[${sql.join(addrIds.map((id) => sql`${id}`), sql`, `)}]::text[]`;
      const playRows = (await db.execute(
        sql`SELECT addressable_id, COALESCE(SUM(play_count), 0)::int AS total
            FROM app.music_play_daily
            WHERE addressable_id = ANY(${addrArray})
            GROUP BY addressable_id`,
      )) as unknown as { addressable_id: string; total: number }[];
      const playsMap = new Map(playRows.map((r) => [r.addressable_id, r.total]));

      // Batch query: unique listeners per track from PostgreSQL
      const listenerRows = (await db.execute(
        sql`SELECT addressable_id, COUNT(*)::int AS count
            FROM app.music_play_listeners
            WHERE addressable_id = ANY(${addrArray})
            GROUP BY addressable_id`,
      )) as unknown as { addressable_id: string; count: number }[];
      const listenersMap = new Map(listenerRows.map((r) => [r.addressable_id, r.count]));

      let totalPlays = 0;
      let totalListeners = 0;
      const trackBreakdown: { addressableId: string; title: string; plays: number }[] = [];

      for (const [addrId, title] of trackMap) {
        const plays = playsMap.get(addrId) ?? 0;
        totalPlays += plays;
        totalListeners += listenersMap.get(addrId) ?? 0;
        trackBreakdown.push({ addressableId: addrId, title, plays });
      }

      trackBreakdown.sort((a, b) => b.plays - a.plays);

      return { totalPlays, totalListeners, trackBreakdown, trackCount: trackMap.size };
    } catch (err) {
      console.error("[insights] getArtistSummary failed:", (err as Error).message);
      throw err;
    }
  },

  async deleteMusic(
    kind: number,
    pubkey: string,
    slug: string,
  ) {
    const { getMeilisearchClient } = await import("../lib/meilisearch.js");
    const { getRedis } = await import("../lib/redis.js");

    // Delete from relay.events and get the deleted rows
    const result = await db.execute(
      sql`DELETE FROM relay.events
          WHERE kind = ${kind}
            AND pubkey = ${pubkey}
            AND tags @> ${JSON.stringify([["d", slug]])}::jsonb
          RETURNING id, tags`,
    );
    const deleted = result as unknown as { id: string; tags: string[][] }[];
    if (deleted.length === 0) return false;

    // Clean up Meilisearch and Redis for each deleted event
    const ms = getMeilisearchClient();
    const redis = getRedis();
    const indexName = kind === 31683 ? "tracks" : "albums";
    const docIds = deleted.map((r) => r.id);

    try {
      await ms.index(indexName).deleteDocuments(docIds);
    } catch { /* doc may not exist */ }

    // Construct the stable addressableId for play data cleanup
    const addressableId = `${kind}:${pubkey}:${slug}`;

    // Decrement genre/tag counts and clean up play/listener keys
    for (const row of deleted) {
      const tags = row.tags;
      const genre = tags.find((t) => t[0] === "genre")?.[1];
      const hashtags = tags.filter((t) => t[0] === "t").map((t) => t[1]);
      if (genre) await redis.zincrby("music:genre_counts", -1, genre);
      for (const t of hashtags) await redis.zincrby("music:tag_counts", -1, t);
      await redis.srem("music:counted_events", row.id);
    }
    await redis.zremrangebyscore("music:genre_counts", "-inf", "0");
    await redis.zremrangebyscore("music:tag_counts", "-inf", "0");

    // Clean up play data from Redis (keyed by addressableId)
    await redis.del(`play_count:${addressableId}`, `unique_listeners:${addressableId}`);
    // Scan and delete daily play keys
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(cursor, "MATCH", `daily_plays:${addressableId}:*`, "COUNT", 100);
      cursor = next;
      if (keys.length > 0) await redis.del(...keys);
    } while (cursor !== "0");

    // Clean up play data from PostgreSQL
    db.execute(sql`DELETE FROM app.music_play_daily WHERE addressable_id = ${addressableId}`)
      .catch((err) => console.error("[music] Failed to delete daily plays:", (err as Error).message));
    db.execute(sql`DELETE FROM app.music_play_listeners WHERE addressable_id = ${addressableId}`)
      .catch((err) => console.error("[music] Failed to delete listeners:", (err as Error).message));

    // Clean up uploaded files from disk + music_uploads table.
    // Extract sha256 hashes and cover URLs from the deleted event tags.
    const audioHashes = new Set<string>();
    const coverUrls = new Set<string>();
    for (const row of deleted) {
      for (const tag of row.tags) {
        if (tag[0] === "imeta") {
          for (let i = 1; i < tag.length; i++) {
            if (tag[i].startsWith("x ")) audioHashes.add(tag[i].slice(2));
          }
        }
        if ((tag[0] === "image" || tag[0] === "thumb") && tag[1]) {
          coverUrls.add(tag[1]);
        }
      }
    }

    // Delete audio files tracked in music_uploads -- look up by sha256 (not URL)
    for (const sha256 of audioHashes) {
      try {
        // Remove music_uploads rows for this pubkey + hash
        const uploads = await db.select().from(musicUploads)
          .where(and(eq(musicUploads.sha256, sha256), eq(musicUploads.pubkey, pubkey)));
        for (const upload of uploads) {
          await db.delete(musicUploads).where(eq(musicUploads.id, upload.id));
        }

        // Remove blob ownership
        await db.delete(blobOwners)
          .where(and(eq(blobOwners.sha256, sha256), eq(blobOwners.pubkey, pubkey)));

        // If no owners remain, purge blob from disk and DB
        const remaining = await db.select().from(blobOwners)
          .where(eq(blobOwners.sha256, sha256)).limit(1);
        if (remaining.length === 0) {
          const [blob] = await db.select().from(blobs).where(eq(blobs.sha256, sha256)).limit(1);
          if (blob) {
            const ext = mimeToExt(blob.type);
            await unlink(join(BLOB_DIR, `${sha256}${ext}`)).catch(() => {});
            // Purge derived HLS output too — other owners' events can't reference
            // derivatives once the source blob is gone.
            await rm(join(BLOB_DIR, "hls", sha256), { recursive: true, force: true }).catch(() => {});
            await db.delete(blobs).where(eq(blobs.sha256, sha256));
          }
        }
      } catch (err) {
        console.error("[music] Failed to clean up audio blob:", sha256, (err as Error).message);
      }
    }

    // Delete cover blobs if no other events still reference them
    for (const url of coverUrls) {
      try {
        const refs = (await db.execute(
          sql`SELECT 1 FROM relay.events
              WHERE tags @> ${JSON.stringify([["image", url]])}::jsonb
              LIMIT 1`,
        )) as unknown[];
        if (refs.length === 0) {
          // Extract sha256 from the URL (format: /<sha256>.<ext>)
          const urlPath = new URL(url, "http://localhost").pathname;
          const filename = urlPath.split("/").pop() ?? "";
          const sha256Match = filename.match(/^([0-9a-f]{64})\.\w+$/);
          if (sha256Match) {
            const sha256 = sha256Match[1];
            await db.delete(blobOwners)
              .where(and(eq(blobOwners.sha256, sha256), eq(blobOwners.pubkey, pubkey)));
            const remaining = await db.select().from(blobOwners)
              .where(eq(blobOwners.sha256, sha256)).limit(1);
            if (remaining.length === 0) {
              await unlink(join(BLOB_DIR, filename)).catch(() => {});
              await db.delete(blobs).where(eq(blobs.sha256, sha256));
            }
          }
        }
      } catch (err) {
        console.error("[music] Failed to clean up cover blob:", url, (err as Error).message);
      }
    }

    return true;
  },

  async listUploads(
    pubkey: string,
    opts?: { limit?: number; offset?: number },
  ) {
    const limit = opts?.limit ?? 50;
    const offset = opts?.offset ?? 0;

    const rows = await db
      .select()
      .from(musicUploads)
      .where(eq(musicUploads.pubkey, pubkey))
      .orderBy(desc(musicUploads.createdAt))
      .limit(limit)
      .offset(offset);

    return rows;
  },
};
