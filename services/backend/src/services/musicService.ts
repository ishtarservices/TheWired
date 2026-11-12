import { createHash } from "crypto";
import { createWriteStream, existsSync } from "fs";
import { mkdir, unlink, rename, rm } from "fs/promises";
import { join, resolve } from "path";
import { Readable } from "stream";
import { eq, desc, sql, and, inArray } from "drizzle-orm";
import { db } from "../db/connection.js";
import { musicUploads } from "../db/schema/music.js";
import { blobs, blobOwners } from "../db/schema/blobs.js";
import { nanoid } from "../lib/id.js";
import { config } from "../config.js";
import { getTranscodeQueue } from "../lib/queue.js";
import { buildMusicSearchDoc } from "../lib/musicSearchDoc.js";
import { escapeMsFilter } from "../lib/meiliFilter.js";
import { MS_LISTED_FILTER, isIndexableMusic, isListedPublicMusic } from "../lib/musicListing.js";
import { suspensionService } from "./suspensionService.js";
import { clearBlobAccessCache } from "./blobAccess.js";
import { invalidateBlobScope } from "./blobReadAccess.js";
import { isDenylisted, recordBlobOwner } from "./blobStore.js";
import { fileTypeFromFile } from "file-type";
import { audioTypeFromSniff, canonicalAudioType } from "../lib/audioMime.js";
import { probeDurationSec } from "../lib/transcode.js";
import { ensureCoverVariants, removeCoverVariants } from "../lib/coverVariants.js";

const BLOB_DIR = resolve(process.cwd(), config.blobDir);
const MAX_AUDIO_SIZE = config.maxBlobSize;
const MAX_COVER_SIZE = 10 * 1024 * 1024; // 10MB

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

/** A client-side upload problem. Carries the HTTP status + code the global
 *  error handler answers with (a plain Error would surface as a 500). */
export class UploadRejectedError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "UploadRejectedError";
  }
}

/** Per-request limits the route resolved from the caller's upload quota. */
export interface UploadLimits {
  /** Bytes the caller may still upload today; the stream is cut when exceeded. */
  quotaRemaining?: number;
  /** Seconds until the quota resets — the 429's Retry-After. */
  quotaRetryAfter?: number;
}

/** The daily byte quota (lib/uploadGuard.ts) ran out mid-stream. */
export class UploadQuotaError extends UploadRejectedError {
  constructor(readonly retryAfter: number) {
    super("Daily upload quota exceeded", 429, "UPLOAD_QUOTA_EXCEEDED");
    this.name = "UploadQuotaError";
  }
}

async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true });
}

/** Whole seconds — `music_uploads.duration` is BIGINT, so a fractional value
 *  (a browser's 213.4 s) must be rounded before the insert, not after. */
function wholeSeconds(sec: number | null | undefined): number | undefined {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return undefined;
  return Math.max(1, Math.round(sec));
}

/**
 * Listed public releases straight from relay.events, newest first: the
 * fallback when the search engine is unreachable, so browse degrades to plain
 * recency instead of a 500. Same bar as the index's listed docs
 * (isListedPublicMusic): no visibility/h, not catalog:none, not a moved stub.
 * Genre/tag match case-insensitively, like the engine's filters.
 */
async function recentListedFromPostgres(
  kind: 31683 | 33123,
  params: { genre?: string; tag?: string; limit: number; offset: number },
): Promise<{ hits: { id: string; addressableId: string }[]; total: number }> {
  const where = [
    sql`kind = ${kind}`,
    sql`visibility IS NULL`,
    sql`h_tag IS NULL`,
    sql`NOT (tags @> '[["catalog","none"]]'::jsonb)`,
    sql`NOT jsonb_path_exists(tags, '$[*] ? (@[0] == "moved")')`,
  ];
  if (params.genre) {
    where.push(sql`EXISTS (SELECT 1 FROM jsonb_array_elements(tags) g
                           WHERE g->>0 = 'genre' AND lower(g->>1) = lower(${params.genre}))`);
  }
  if (params.tag) {
    where.push(sql`EXISTS (SELECT 1 FROM jsonb_array_elements(tags) t
                           WHERE t->>0 = 't' AND lower(t->>1) = lower(${params.tag}))`);
  }
  const rows = (await db.execute(
    sql`SELECT id, pubkey, d_tag, COUNT(*) OVER()::int AS total
        FROM relay.events
        WHERE ${sql.join(where, sql` AND `)}
        ORDER BY created_at DESC
        LIMIT ${params.limit} OFFSET ${params.offset}`,
  )) as unknown as { id: string; pubkey: string; d_tag: string | null; total: number }[];
  return {
    hits: rows.map((r) => ({ id: r.id, addressableId: `${kind}:${r.pubkey}:${r.d_tag ?? ""}` })),
    total: rows[0]?.total ?? 0,
  };
}

type MusicIndex = "tracks" | "albums";

/**
 * Delete the docs in a music index that no longer stand for an indexable
 * event. Every candidate (a doc the rebuild didn't just write) is re-checked
 * against Postgres before it goes, so a release ingested while the rebuild was
 * scanning (indexed by ingest, missed by the scan) is never pruned.
 */
async function pruneMusicDocs(
  index: MusicIndex,
  keep: Set<string>,
  suspended: Set<string>,
): Promise<number> {
  const { getMeilisearchClient } = await import("../lib/meilisearch.js");
  const msIndex = getMeilisearchClient().index(index);
  const PAGE = 1000;

  const candidates: string[] = [];
  try {
    for (let offset = 0; ; offset += PAGE) {
      const page = await msIndex.getDocuments<{ id: string }>({ fields: ["id"], limit: PAGE, offset });
      for (const doc of page.results) if (!keep.has(doc.id)) candidates.push(doc.id);
      if (page.results.length < PAGE) break;
    }
  } catch (err) {
    // A fresh engine with no releases of this kind has no index yet: nothing to prune.
    if ((err as { cause?: { code?: string } }).cause?.code === "index_not_found") return 0;
    throw err;
  }

  const stale: string[] = [];
  for (let i = 0; i < candidates.length; i += PAGE) {
    const chunk = candidates.slice(i, i + PAGE);
    const live = (await db.execute(
      sql`SELECT id, pubkey, tags FROM relay.events
          WHERE id IN (${sql.join(chunk.map((id) => sql`${id}`), sql`, `)})`,
    )) as unknown as { id: string; pubkey: string; tags: string[][] }[];
    const backed = new Set(
      live.filter((r) => !suspended.has(r.pubkey) && isIndexableMusic(r.tags)).map((r) => r.id),
    );
    stale.push(...chunk.filter((id) => !backed.has(id)));
  }

  if (stale.length > 0) await msIndex.deleteDocuments(stale);
  return stale.length;
}

export const musicService = {
  async uploadAudio(
    file: { filename: string; mimetype: string; file: NodeJS.ReadableStream },
    pubkey: string,
    clientDuration?: number,
    limits: UploadLimits = {},
  ) {
    // The declared type is only a cheap pre-check (a non-audio Content-Type
    // is refused before the body is read). The STORED type comes from the
    // bytes below; the declared one is otherwise ignored.
    if (!canonicalAudioType(file.mimetype)) {
      // Drain the part so the multipart parser can finish the request cleanly.
      file.file.resume();
      throw new UploadRejectedError(
        `Unsupported audio type: ${file.mimetype || "(none)"}`,
        400,
        "INVALID_AUDIO_TYPE",
      );
    }

    await ensureDir(BLOB_DIR);

    // Stream to a temp file first (we can't name by hash until we know it)
    const tempId = nanoid(16);
    const tempPath = join(BLOB_DIR, `.tmp_${tempId}`);

    let size = 0;
    const writeStream = createWriteStream(tempPath);
    const hash = createHash("sha256");
    const readable = file.file instanceof Readable ? file.file : Readable.from(file.file as AsyncIterable<Buffer>);

    for await (const chunk of readable) {
      size += (chunk as Buffer).length;
      if (size > MAX_AUDIO_SIZE) {
        writeStream.destroy();
        await unlink(tempPath).catch(() => {});
        throw new UploadRejectedError("File too large (max 100MB)", 413, "FILE_TOO_LARGE");
      }
      if (limits.quotaRemaining !== undefined && size > limits.quotaRemaining) {
        writeStream.destroy();
        await unlink(tempPath).catch(() => {});
        throw new UploadQuotaError(limits.quotaRetryAfter ?? 60);
      }
      hash.update(chunk as Buffer);
      writeStream.write(chunk);
    }
    await new Promise<void>((resolve, reject) => {
      writeStream.end(() => resolve());
      writeStream.on("error", reject);
    });

    const sha256 = hash.digest("hex");
    const storagePath = join(BLOB_DIR, sha256);

    // The bytes decide the type. ffprobe/ffmpeg run on this file, and
    // libavformat would happily read a playlist or concat script as "audio"
    // that opens further files and URLs — so nothing that is not a known
    // audio container gets stored, probed or queued.
    const sniffed = await fileTypeFromFile(tempPath).catch(() => undefined);
    const mimeType = audioTypeFromSniff(sniffed?.mime);
    if (!mimeType) {
      await unlink(tempPath).catch(() => {});
      throw new UploadRejectedError(
        "File is not a supported audio container",
        415,
        "INVALID_AUDIO_CONTAINER",
      );
    }

    if (await isDenylisted(sha256)) {
      await unlink(tempPath).catch(() => {});
      throw new UploadRejectedError("This file was removed by moderation", 451, "BLOB_DENYLISTED");
    }

    // Dedup: if blob already exists on disk, skip the rename
    if (existsSync(storagePath)) {
      await unlink(tempPath).catch(() => {});
    } else {
      await rename(tempPath, storagePath);
    }

    const url = `${config.publicUrl}/${sha256}`;
    const uploaded = Math.floor(Date.now() / 1000);

    // Duration: ffprobe ground truth when it can read the file (mobile clients
    // send none — expo's native multipart carries no probed length), else the
    // client's claim. Stored and returned in whole seconds (BIGINT column).
    const duration = wholeSeconds((await probeDurationSec(storagePath, mimeType)) ?? clientDuration);

    // Insert into blobs table (dedup-safe). Music owners are `neutral`: the
    // music gate decides access, and an existing public/scoped row is kept.
    await db.insert(blobs).values({ sha256, size, type: mimeType, uploaded }).onConflictDoNothing();
    await recordBlobOwner(sha256, pubkey, { state: "neutral" });

    // Insert into music_uploads for music-specific metadata
    const id = nanoid(16);
    await db.insert(musicUploads).values({
      id,
      pubkey,
      originalFilename: file.filename,
      storagePath,
      url,
      sha256,
      mimeType,
      fileSize: size,
      duration: duration ?? null,
    });

    // Enqueue transcode job if the pipeline is enabled. `jobId: sha256` dedupes:
    // re-uploads of the same audio by different users produce one job.
    if (config.transcodeEnqueue) {
      try {
        await getTranscodeQueue().add(
          "transcode",
          { sha256, mimeType, storagePath },
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
      mimeType,
      duration,
    };
  },

  async uploadCover(
    file: { filename: string; mimetype: string; file: NodeJS.ReadableStream },
    pubkey: string,
    limits: UploadLimits = {},
  ) {
    if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      file.file.resume();
      throw new UploadRejectedError(
        `Unsupported image type: ${file.mimetype || "(none)"}`,
        400,
        "INVALID_IMAGE_TYPE",
      );
    }

    await ensureDir(BLOB_DIR);

    const tempId = nanoid(16);
    const tempPath = join(BLOB_DIR, `.tmp_${tempId}`);

    let size = 0;
    const writeStream = createWriteStream(tempPath);
    const hash = createHash("sha256");
    const readable = file.file instanceof Readable ? file.file : Readable.from(file.file as AsyncIterable<Buffer>);

    for await (const chunk of readable) {
      size += (chunk as Buffer).length;
      if (size > MAX_COVER_SIZE) {
        writeStream.destroy();
        await unlink(tempPath).catch(() => {});
        throw new UploadRejectedError("Image too large (max 10MB)", 413, "FILE_TOO_LARGE");
      }
      if (limits.quotaRemaining !== undefined && size > limits.quotaRemaining) {
        writeStream.destroy();
        await unlink(tempPath).catch(() => {});
        throw new UploadQuotaError(limits.quotaRetryAfter ?? 60);
      }
      hash.update(chunk as Buffer);
      writeStream.write(chunk);
    }
    await new Promise<void>((resolve, reject) => {
      writeStream.end(() => resolve());
      writeStream.on("error", reject);
    });

    const sha256 = hash.digest("hex");
    const storagePath = join(BLOB_DIR, sha256);

    // Stored (and served) as the image the bytes are, not the one declared.
    const sniffed = await fileTypeFromFile(tempPath).catch(() => undefined);
    const imageType = sniffed && ALLOWED_IMAGE_TYPES.has(sniffed.mime) ? sniffed.mime : null;
    if (!imageType) {
      await unlink(tempPath).catch(() => {});
      throw new UploadRejectedError("File is not a supported image", 415, "INVALID_IMAGE_CONTAINER");
    }

    if (await isDenylisted(sha256)) {
      await unlink(tempPath).catch(() => {});
      throw new UploadRejectedError("This file was removed by moderation", 451, "BLOB_DENYLISTED");
    }

    if (existsSync(storagePath)) {
      await unlink(tempPath).catch(() => {});
    } else {
      await rename(tempPath, storagePath);
    }

    const url = `${config.publicUrl}/${sha256}`;
    const uploaded = Math.floor(Date.now() / 1000);

    // Insert into blobs table (covers now tracked in DB); a `neutral` owner, as above.
    await db.insert(blobs).values({ sha256, size, type: imageType, uploaded }).onConflictDoNothing();
    await recordBlobOwner(sha256, pubkey, { state: "neutral" });

    // Resized copies for `GET /<sha>?w=`; the original stays as uploaded. A
    // failed render doesn't fail the upload — sized requests fall back to it.
    await ensureCoverVariants(sha256, storagePath, BLOB_DIR);

    return { url, sha256, size };
  },

  /**
   * Move the signer's ownership of `shas` to `to` (key rotation). Per sha:
   * the signer's blob_owners row becomes `to`'s (merged with a row `to`
   * already has: public > scoped > neutral), its blob_scopes rows move with it,
   * and music_uploads rows the signer holds for that sha are re-attributed.
   * Shas the signer does not own are skipped, so a replay changes nothing.
   */
  async transferBlobs(signer: string, to: string, shas: string[]): Promise<{ moved: string[]; skipped: string[] }> {
    const moved: string[] = [];
    await db.transaction(async (tx) => {
      const owned = await tx
        .select({ sha256: blobOwners.sha256, uploadState: blobOwners.uploadState })
        .from(blobOwners)
        .where(and(eq(blobOwners.pubkey, signer), inArray(blobOwners.sha256, shas)));
      const ownedState = new Map(owned.map((r) => [r.sha256, r.uploadState]));
      for (const sha of shas) {
        const state = ownedState.get(sha);
        if (!state) continue;
        await tx.execute(
          sql`INSERT INTO app.blob_owners AS o (sha256, pubkey, upload_state) VALUES (${sha}, ${to}, ${state})
              ON CONFLICT (sha256, pubkey) DO UPDATE SET upload_state = CASE
                WHEN 'public' IN (o.upload_state, EXCLUDED.upload_state) THEN 'public'
                WHEN 'scoped' IN (o.upload_state, EXCLUDED.upload_state) THEN 'scoped'
                ELSE 'neutral' END`,
        );
        await tx.execute(
          sql`INSERT INTO app.blob_scopes (sha256, space_id, pubkey, created_at)
              SELECT sha256, space_id, ${to}, created_at FROM app.blob_scopes
              WHERE sha256 = ${sha} AND pubkey = ${signer}
              ON CONFLICT DO NOTHING`,
        );
        await tx.delete(blobOwners).where(and(eq(blobOwners.sha256, sha), eq(blobOwners.pubkey, signer)));
        await tx
          .update(musicUploads)
          .set({ pubkey: to })
          .where(and(eq(musicUploads.sha256, sha), eq(musicUploads.pubkey, signer)));
        moved.push(sha);
      }
    });
    if (moved.length > 0) clearBlobAccessCache();
    for (const sha of moved) invalidateBlobScope(sha);
    return { moved, skipped: shas.filter((s) => !moved.includes(s)) };
  },

  /**
   * Full reindex: scan relay.events (Postgres) for all music events, upsert
   * them into the Meilisearch tracks/albums indexes, prune docs Postgres no
   * longer backs, and rebuild the Redis counts. The recovery path when
   * Meilisearch is out of sync with the relay DB, and it runs on every boot,
   * so it must never blank anything mid-rebuild: docs are upserted by event id
   * (no delete-all first) and the counts are swapped in one MULTI. The counts
   * come from Postgres alone, so they are rebuilt even when the engine is
   * unreachable; its error is rethrown afterwards.
   */
  async rebuildCounts() {
    const { getMeilisearchClient } = await import("../lib/meilisearch.js");
    const { getRedis } = await import("../lib/redis.js");
    const ms = getMeilisearchClient();
    const redis = getRedis();

    const genreCounts = new Map<string, number>();
    const tagCounts = new Map<string, number>();
    const eventIds: string[] = [];
    const BATCH = 200;
    const suspended = await suspensionService.suspendedSet();

    // Doc ids this rebuild wrote; anything else in an index is a prune candidate.
    const indexed: Record<MusicIndex, Set<string>> = { tracks: new Set(), albums: new Set() };
    let engineError: unknown = null;
    const upsert = async (index: MusicIndex, docs: ReturnType<typeof buildMusicSearchDoc>[]) => {
      for (const doc of docs) indexed[index].add(doc.id);
      if (docs.length === 0 || engineError) return;
      try {
        await ms.index(index).addDocuments(docs);
      } catch (err) {
        engineError = err;
      }
    };

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
        if (suspended.has(row.pubkey)) continue; // hidden while suspended
        const tags = row.tags;
        const genre = tags.find((t) => t[0] === "genre")?.[1] ?? "";
        const hashtags = tags.filter((t) => t[0] === "t").map((t) => t[1]);

        // Index every public track (the doc carries `unlisted` so browse/search
        // can filter it while insights still enumerate it)...
        if (isIndexableMusic(tags)) {
          msDocs.push(
            buildMusicSearchDoc(
              { id: row.id, pubkey: row.pubkey, created_at: Number(row.created_at), tags },
              31683,
            ),
          );
        }
        // ...but only count LISTED tracks, so chip counts match what browse returns.
        if (isListedPublicMusic(tags)) {
          eventIds.push(row.id);
          if (genre) genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1);
          for (const tag of hashtags) {
            tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
          }
        }
      }

      await upsert("tracks", msDocs);

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
        if (suspended.has(row.pubkey)) continue; // hidden while suspended
        const tags = row.tags;
        const genre = tags.find((t) => t[0] === "genre")?.[1] ?? "";
        const hashtags = tags.filter((t) => t[0] === "t").map((t) => t[1]);

        // Only index and count public albums
        if (isIndexableMusic(tags)) {
          msDocs.push(
            buildMusicSearchDoc(
              { id: row.id, pubkey: row.pubkey, created_at: Number(row.created_at), tags },
              33123,
            ),
          );

          eventIds.push(row.id);
          if (genre) genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1);
          for (const tag of hashtags) {
            tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
          }
        }
      }

      await upsert("albums", msDocs);

      lastId = rows[rows.length - 1].id;
      if (rows.length < BATCH) break;
    }

    // Swap the fresh counts in atomically: genre/tag chips never read empty.
    const tx = redis.multi();
    tx.del("music:genre_counts", "music:tag_counts", "music:counted_events");
    for (const [genre, count] of genreCounts) {
      tx.zadd("music:genre_counts", count, genre);
    }
    for (const [tag, count] of tagCounts) {
      tx.zadd("music:tag_counts", count, tag);
    }
    if (eventIds.length > 0) {
      tx.sadd("music:counted_events", ...eventIds);
    }
    await tx.exec();

    // Prune only after every upsert landed: a partial rebuild must not delete
    // docs it merely failed to rewrite.
    let pruned = 0;
    if (!engineError) {
      try {
        pruned += await pruneMusicDocs("tracks", indexed.tracks, suspended);
        pruned += await pruneMusicDocs("albums", indexed.albums, suspended);
      } catch (err) {
        engineError = err;
      }
    }
    if (engineError) throw engineError;

    return {
      genres: genreCounts.size,
      tags: tagCounts.size,
      tracksAndAlbums: eventIds.length,
      pruned,
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
      const filters: string[] = [MS_LISTED_FILTER];
      if (params.genre) filters.push(`genre = "${escapeMsFilter(params.genre)}"`);
      if (params.tag) filters.push(`hashtags = "${escapeMsFilter(params.tag)}"`);

      // Extract both eventId and addressableId from hits
      let candidates: { eventId: string; addressableId: string }[];
      try {
        const results = await ms.index("tracks").search("", {
          filter: filters.join(" AND "),
          limit: 500, // fetch a large pool to sort by plays
        });
        candidates = results.hits.map((h: Record<string, unknown>) => ({
          eventId: h.id as string,
          addressableId: h.addressable_id as string,
        }));
        total = results.estimatedTotalHits ?? 0;
      } catch {
        // Engine down: rank the newest listed releases instead of failing.
        const pool = await recentListedFromPostgres(31683, { ...params, limit: 500, offset: 0 });
        candidates = pool.hits.map((h) => ({ eventId: h.id, addressableId: h.addressableId }));
        total = pool.total;
      }

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
      // Meilisearch filtered search — "recent" sort. `["catalog","none"]`
      // tracks are in the index (insights need them) but never in browse.
      const filters: string[] = [MS_LISTED_FILTER];
      if (params.genre) filters.push(`genre = "${escapeMsFilter(params.genre)}"`);
      if (params.tag) filters.push(`hashtags = "${escapeMsFilter(params.tag)}"`);

      try {
        const results = await ms.index("tracks").search("", {
          filter: filters.join(" AND "),
          sort: ["created_at:desc"],
          limit,
          offset,
        });
        eventIds = results.hits.map((h: Record<string, unknown>) => h.id as string);
        total = results.estimatedTotalHits ?? 0;
      } catch {
        // Engine down: recency needs no search engine, so serve it from Postgres.
        const recent = await recentListedFromPostgres(31683, { ...params, limit, offset });
        eventIds = recent.hits.map((h) => h.id);
        total = recent.total;
      }
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
    const normalized = await suspensionService.withoutSuspended(
      rows.map((r) => ({ ...r, created_at: Number(r.created_at) })),
      (r) => r.pubkey,
    );
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

      try {
        const results = await ms.index("albums").search("", {
          filter: filters.length > 0 ? filters.join(" AND ") : undefined,
          sort: ["created_at:desc"],
          limit,
          offset,
        });
        eventIds = results.hits.map((h: Record<string, unknown>) => h.id as string);
        total = results.estimatedTotalHits ?? 0;
      } catch {
        // Engine down: same Postgres recency fallback as track browse.
        const recent = await recentListedFromPostgres(33123, { ...params, limit, offset });
        eventIds = recent.hits.map((h) => h.id);
        total = recent.total;
      }
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

    const normalized = await suspensionService.withoutSuspended(
      rows.map((r) => ({ ...r, created_at: Number(r.created_at) })),
      (r) => r.pubkey,
    );
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
      // Only undo counts this event added (an unlisted or private one never did).
      if (!(await redis.srem("music:counted_events", row.id))) continue;
      if (genre) await redis.zincrby("music:genre_counts", -1, genre);
      for (const t of hashtags) await redis.zincrby("music:tag_counts", -1, t);
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
        // Another of the owner's events (a second track, a release that
        // shares the recording) may still carry this hash in its imeta; then
        // the upload, the ownership and the bytes stay. Covers already do this.
        const stillReferenced = (await db.execute(
          sql`SELECT 1 FROM relay.events
              WHERE pubkey = ${pubkey}
                AND tags @> ${JSON.stringify([["imeta", `x ${sha256}`]])}::jsonb
              LIMIT 1`,
        )) as unknown[];
        if (stillReferenced.length > 0) continue;

        // Remove music_uploads rows for this pubkey + hash
        const uploads = await db.select().from(musicUploads)
          .where(and(eq(musicUploads.sha256, sha256), eq(musicUploads.pubkey, pubkey)));
        for (const upload of uploads) {
          await db.delete(musicUploads).where(eq(musicUploads.id, upload.id));
        }

        // Remove blob ownership (its blob_scopes rows cascade)
        await db.delete(blobOwners)
          .where(and(eq(blobOwners.sha256, sha256), eq(blobOwners.pubkey, pubkey)));
        invalidateBlobScope(sha256);

        // If no owners remain, purge blob from disk and DB
        const remaining = await db.select().from(blobOwners)
          .where(eq(blobOwners.sha256, sha256)).limit(1);
        if (remaining.length === 0) {
          const [blob] = await db.select().from(blobs).where(eq(blobs.sha256, sha256)).limit(1);
          if (blob) {
            await unlink(join(BLOB_DIR, sha256)).catch(() => {});
            // Purge derived HLS output too — other owners' events can't reference
            // derivatives once the source blob is gone.
            await rm(join(BLOB_DIR, "hls", sha256), { recursive: true, force: true }).catch(() => {});
            await removeCoverVariants(BLOB_DIR, sha256);
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
          // Extract sha256 from the URL (accepts bare `/<sha>` and legacy `/<sha>.<ext>`)
          const urlPath = new URL(url, "http://localhost").pathname;
          const filename = urlPath.split("/").pop() ?? "";
          const sha256Match = filename.match(/^([0-9a-f]{64})(?:\.[A-Za-z0-9]+)?$/);
          if (sha256Match) {
            const sha256 = sha256Match[1];
            await db.delete(blobOwners)
              .where(and(eq(blobOwners.sha256, sha256), eq(blobOwners.pubkey, pubkey)));
            invalidateBlobScope(sha256);
            const remaining = await db.select().from(blobOwners)
              .where(eq(blobOwners.sha256, sha256)).limit(1);
            if (remaining.length === 0) {
              await unlink(join(BLOB_DIR, sha256)).catch(() => {});
              await removeCoverVariants(BLOB_DIR, sha256);
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
