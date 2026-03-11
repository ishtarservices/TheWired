import { createHash } from "crypto";
import { createReadStream, createWriteStream } from "fs";
import { mkdir } from "fs/promises";
import { join, extname } from "path";
import { Readable } from "stream";
import { eq, desc, sql } from "drizzle-orm";
import { db } from "../db/connection.js";
import { musicUploads } from "../db/schema/music.js";
import { nanoid } from "../lib/id.js";
import { config } from "../config.js";

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? join(process.cwd(), "uploads", "music");
const COVER_DIR = process.env.UPLOAD_DIR ?? join(process.cwd(), "uploads", "covers");
const MAX_AUDIO_SIZE = 100 * 1024 * 1024; // 100MB
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

async function computeSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
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

    await ensureDir(UPLOAD_DIR);
    const id = nanoid(16);
    const ext = extname(file.filename) || ".mp3";
    const storedName = `${id}${ext}`;
    const storagePath = join(UPLOAD_DIR, storedName);

    // Write file to disk
    let size = 0;
    const writeStream = createWriteStream(storagePath);
    const readable = file.file instanceof Readable ? file.file : Readable.from(file.file as AsyncIterable<Buffer>);

    for await (const chunk of readable) {
      size += (chunk as Buffer).length;
      if (size > MAX_AUDIO_SIZE) {
        writeStream.destroy();
        throw new Error("File too large (max 100MB)");
      }
      writeStream.write(chunk);
    }
    writeStream.end();

    const sha256 = await computeSha256(storagePath);
    const url = `${config.publicUrl}/uploads/music/${storedName}`;

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
    _pubkey: string,
  ) {
    if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      throw new Error(`Invalid image type: ${file.mimetype}`);
    }

    await ensureDir(COVER_DIR);
    const id = nanoid(16);
    const ext = extname(file.filename) || ".jpg";
    const storedName = `${id}${ext}`;
    const storagePath = join(COVER_DIR, storedName);

    let size = 0;
    const writeStream = createWriteStream(storagePath);
    const readable = file.file instanceof Readable ? file.file : Readable.from(file.file as AsyncIterable<Buffer>);

    for await (const chunk of readable) {
      size += (chunk as Buffer).length;
      if (size > MAX_COVER_SIZE) {
        writeStream.destroy();
        throw new Error("Image too large (max 10MB)");
      }
      writeStream.write(chunk);
    }
    writeStream.end();

    return { url: `${config.publicUrl}/uploads/covers/${storedName}` };
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
        const hashtags = tags.filter((t) => t[0] === "t").map((t) => t[1]);

        // Skip unlisted from search index but still count
        if (visibility !== "unlisted") {
          msDocs.push({
            id: row.id,
            addressable_id: `31683:${row.pubkey}:${dTag}`,
            title, artist, genre, image_url: imageUrl, hashtags,
            pubkey: row.pubkey,
            created_at: Number(row.created_at), // PG bigint → JS number
          });
        }

        eventIds.push(row.id);
        if (genre) genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1);
        for (const tag of hashtags) {
          tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
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
        const hashtags = tags.filter((t) => t[0] === "t").map((t) => t[1]);

        if (visibility !== "unlisted") {
          msDocs.push({
            id: row.id,
            addressable_id: `33123:${row.pubkey}:${dTag}`,
            title, artist, genre, image_url: imageUrl, hashtags,
            pubkey: row.pubkey,
            created_at: Number(row.created_at), // PG bigint → JS number
          });
        }

        eventIds.push(row.id);
        if (genre) genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1);
        for (const tag of hashtags) {
          tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
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

      const candidateIds = results.hits.map((h: Record<string, unknown>) => h.id as string);
      total = results.estimatedTotalHits ?? 0;

      if (candidateIds.length > 0) {
        // Batch-fetch play counts from Redis
        const pipeline = redis.pipeline();
        for (const id of candidateIds) pipeline.get(`play_count:${id}`);
        const counts = await pipeline.exec();

        const scored = candidateIds.map((id, i) => ({
          id,
          plays: parseInt((counts?.[i]?.[1] as string) ?? "0", 10),
        }));
        scored.sort((a, b) => b.plays - a.plays);
        eventIds = scored.slice(offset, offset + limit).map((s) => s.id);
      }
    } else if (params.sort === "trending" && params.genre) {
      // Use Redis trending sorted sets
      const key = `trending:music:tracks:genre:${escapeMsFilter(params.genre).toLowerCase()}`;
      eventIds = await redis.zrevrange(key, offset, offset + limit - 1);
      total = eventIds.length;
    } else {
      // Meilisearch filtered search — "recent" or "trending" fallback
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
    const ms = getMeilisearchClient();
    const limit = params.limit ?? 20;
    const offset = params.offset ?? 0;

    const filters: string[] = [];
    if (params.genre) filters.push(`genre = "${escapeMsFilter(params.genre)}"`);
    if (params.tag) filters.push(`hashtags = "${escapeMsFilter(params.tag)}"`);

    const results = await ms.index("albums").search("", {
      filter: filters.length > 0 ? filters.join(" AND ") : undefined,
      sort: ["created_at:desc"],
      limit,
      offset,
    });

    const eventIds = results.hits.map((h: Record<string, unknown>) => h.id as string);
    const total = results.estimatedTotalHits ?? 0;

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

  async recordPlay(eventId: string, pubkey: string) {
    const { getRedis } = await import("../lib/redis.js");
    const redis = getRedis();

    // Dedup: 30s cooldown per pubkey per event
    const dedupKey = `played:${pubkey}:${eventId}`;
    const wasSet = await redis.set(dedupKey, "1", "EX", 30, "NX");
    if (!wasSet) return false;

    // Increment play count
    await redis.incr(`play_count:${eventId}`);

    // Track unique listeners (HyperLogLog)
    await redis.pfadd(`unique_listeners:${eventId}`, pubkey);

    // Track daily plays
    const today = new Date().toISOString().split("T")[0];
    const dailyKey = `daily_plays:${eventId}:${today}`;
    await redis.incr(dailyKey);
    await redis.expire(dailyKey, 90 * 24 * 3600); // 90-day TTL

    // Record in listening history (sorted set, cap at 500)
    const ts = Math.floor(Date.now() / 1000);
    await redis.zadd(`listening_history:${pubkey}`, ts, eventId);
    await redis.zremrangebyrank(`listening_history:${pubkey}`, 0, -501);

    return true;
  },

  async getInsights(addressableId: string) {
    const { getRedis } = await import("../lib/redis.js");
    const { getMeilisearchClient } = await import("../lib/meilisearch.js");
    const redis = getRedis();
    const ms = getMeilisearchClient();

    // Find the event ID for this addressable ID
    const [kindStr] = addressableId.split(":");
    const kind = parseInt(kindStr, 10);
    const indexName = kind === 31683 ? "tracks" : "albums";

    const results = await ms.index(indexName).search("", {
      filter: `addressable_id = "${escapeMsFilter(addressableId)}"`,
      limit: 1,
    });

    if (results.hits.length === 0) {
      return { totalPlays: 0, uniqueListeners: 0, dailyPlays: [], trend: "stable" as const };
    }

    const eventId = results.hits[0].id as string;

    // Total plays
    const totalPlaysStr = await redis.get(`play_count:${eventId}`);
    const totalPlays = totalPlaysStr ? parseInt(totalPlaysStr, 10) : 0;

    // Unique listeners (HyperLogLog)
    const uniqueListeners = await redis.pfcount(`unique_listeners:${eventId}`);

    // Daily plays for last 30 days
    const dailyPlays: { date: string; count: number }[] = [];
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split("T")[0];
      const countStr = await redis.get(`daily_plays:${eventId}:${dateStr}`);
      dailyPlays.push({ date: dateStr, count: countStr ? parseInt(countStr, 10) : 0 });
    }

    // Trend: compare last 7 days to previous 7 days
    const last7 = dailyPlays.slice(-7).reduce((s, d) => s + d.count, 0);
    const prev7 = dailyPlays.slice(-14, -7).reduce((s, d) => s + d.count, 0);
    const trend = last7 > prev7 * 1.1 ? "up" as const : last7 < prev7 * 0.9 ? "down" as const : "stable" as const;

    return { totalPlays, uniqueListeners, dailyPlays, trend };
  },

  async getArtistSummary(pubkey: string) {
    const { getRedis } = await import("../lib/redis.js");
    const { getMeilisearchClient } = await import("../lib/meilisearch.js");
    const redis = getRedis();
    const ms = getMeilisearchClient();

    // Find all tracks by this pubkey
    const results = await ms.index("tracks").search("", {
      filter: `pubkey = "${escapeMsFilter(pubkey)}"`,
      limit: 500,
    });

    let totalPlays = 0;
    let totalListeners = 0;
    const trackBreakdown: { addressableId: string; title: string; plays: number }[] = [];

    for (const hit of results.hits) {
      const eventId = hit.id as string;
      const addrId = hit.addressable_id as string;
      const title = hit.title as string;

      const playsStr = await redis.get(`play_count:${eventId}`);
      const plays = playsStr ? parseInt(playsStr, 10) : 0;
      totalPlays += plays;

      const listeners = await redis.pfcount(`unique_listeners:${eventId}`);
      totalListeners += listeners;

      trackBreakdown.push({ addressableId: addrId, title, plays });
    }

    // Sort by plays descending
    trackBreakdown.sort((a, b) => b.plays - a.plays);

    return { totalPlays, totalListeners, trackBreakdown, trackCount: results.hits.length };
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

    // Decrement genre/tag counts and clean up play/listener keys
    for (const row of deleted) {
      const tags = row.tags;
      const genre = tags.find((t) => t[0] === "genre")?.[1];
      const hashtags = tags.filter((t) => t[0] === "t").map((t) => t[1]);
      if (genre) await redis.zincrby("music:genre_counts", -1, genre);
      for (const t of hashtags) await redis.zincrby("music:tag_counts", -1, t);
      await redis.srem("music:counted_events", row.id);
      // Clean up play count and listener tracking keys
      await redis.del(`play_count:${row.id}`, `unique_listeners:${row.id}`);
    }
    await redis.zremrangebyscore("music:genre_counts", "-inf", "0");
    await redis.zremrangebyscore("music:tag_counts", "-inf", "0");

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
