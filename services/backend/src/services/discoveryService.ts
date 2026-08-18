import { eq, desc, asc, and, sql, inArray } from "drizzle-orm";
import { db } from "../db/connection.js";
import { spaces, spaceTags } from "../db/schema/spaces.js";
import { listingRequests, spaceCategories, relayDirectory, scenes } from "../db/schema/discovery.js";
import { parseZapSats } from "../lib/nostr/zapAmount.js";
import { config } from "../config.js";
import crypto from "crypto";

/** Split a `tag=a,b,c` query value into a deduped, trimmed OR-list. */
export function parseTagList(raw: string | undefined): string[] {
  if (!raw) return [];
  const parts = raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  return [...new Set(parts)];
}

/**
 * Order a candidate pool by its Redis trending score, keeping recency as the
 * tiebreak for anything the trending computer hasn't scored. The pool is already
 * recency-ordered, so an entirely unscored pool degrades to `sort=recent`
 * instead of coming back empty.
 */
async function rankByTrending<T extends { id: string; created_at: number }>(
  pool: T[],
  zsetKey: string,
): Promise<T[]> {
  if (pool.length === 0) return pool;

  const { getRedis } = await import("../lib/redis.js");
  const redis = getRedis();

  const pipeline = redis.pipeline();
  for (const item of pool) pipeline.zscore(zsetKey, item.id);
  const results = await pipeline.exec();

  const scored = pool.map((item, i) => ({
    item,
    score: parseFloat((results?.[i]?.[1] as string) ?? "0") || 0,
  }));

  scored.sort((a, b) => b.score - a.score || b.item.created_at - a.item.created_at);
  return scored.map((s) => s.item);
}

export const discoveryService = {
  // ── Space discovery ──────────────────────────────────────────────

  async getListedSpaces(opts: {
    category?: string;
    /** One tag, or a comma-separated OR-list — a scene spans several tags. */
    tag?: string;
    sort?: "trending" | "newest" | "popular";
    search?: string;
    limit?: number;
    offset?: number;
  }) {
    const limit = Math.min(opts.limit ?? 20, 100);
    const offset = opts.offset ?? 0;

    const conditions = [eq(spaces.listed, true)];

    if (opts.category) {
      conditions.push(eq(spaces.category, opts.category));
    }

    if (opts.search) {
      conditions.push(
        sql`(${spaces.name} ILIKE ${"%" + opts.search + "%"} OR ${spaces.about} ILIKE ${"%" + opts.search + "%"})`,
      );
    }

    // Tag filtering runs in SQL, not post-hoc on the page: filtering after
    // LIMIT/OFFSET would silently return fewer rows than `limit` (and drop
    // matches entirely once a scene's spaces fall past the first page).
    const tagList = parseTagList(opts.tag);
    if (tagList.length > 0) {
      conditions.push(
        sql`EXISTS (
          SELECT 1 FROM app.space_tags st
          WHERE st.space_id = ${spaces.id}
            AND lower(st.tag) IN (${sql.join(
              tagList.map((t) => sql`${t.toLowerCase()}`),
              sql`, `,
            )})
        )`,
      );
    }

    let orderBy;
    switch (opts.sort) {
      case "trending":
        orderBy = desc(spaces.discoveryScore);
        break;
      case "newest":
        orderBy = desc(spaces.createdAt);
        break;
      case "popular":
      default:
        orderBy = desc(spaces.memberCount);
        break;
    }

    const results = await db
      .select()
      .from(spaces)
      .where(and(...conditions))
      .orderBy(orderBy)
      .limit(limit)
      .offset(offset);

    return this.attachTags(results);
  },

  /** Attach each space's `tags` array in one round-trip. */
  async attachTags<T extends { id: string }>(rows: T[]): Promise<(T & { tags: string[] })[]> {
    if (rows.length === 0) return [];

    const tags = await db
      .select()
      .from(spaceTags)
      .where(inArray(spaceTags.spaceId, rows.map((s) => s.id)));

    const tagMap = new Map<string, string[]>();
    for (const t of tags) {
      if (!tagMap.has(t.spaceId)) tagMap.set(t.spaceId, []);
      tagMap.get(t.spaceId)!.push(t.tag);
    }

    return rows.map((s) => ({ ...s, tags: tagMap.get(s.id) ?? [] }));
  },

  async getFeaturedSpaces() {
    const results = await db
      .select()
      .from(spaces)
      .where(and(eq(spaces.listed, true), eq(spaces.featured, true)))
      .orderBy(desc(spaces.discoveryScore))
      .limit(12);

    return results.map((s) => ({ ...s, tags: [] as string[] }));
  },

  // ── Categories ──────────────────────────────────────────────────

  async getCategories() {
    const cats = await db
      .select()
      .from(spaceCategories)
      .orderBy(asc(spaceCategories.position));

    // Get space counts per category
    const counts = await db.execute(sql`
      SELECT category, COUNT(*)::int as count
      FROM app.spaces
      WHERE listed = true AND category IS NOT NULL
      GROUP BY category
    `);

    const countMap = new Map<string, number>();
    for (const row of counts as unknown as Array<{ category: string; count: number }>) {
      countMap.set(row.category, row.count);
    }

    return cats.map((c) => ({
      ...c,
      spaceCount: countMap.get(c.slug) ?? 0,
    }));
  },

  // ── Scenes ──────────────────────────────────────────────────────

  /**
   * The music-first browse vocabulary. `spaceCount` counts listed spaces
   * carrying any of the scene's tags, so a client can hide scenes that would
   * open onto an empty rail.
   */
  async getScenes() {
    const rows = await db.select().from(scenes).orderBy(asc(scenes.position), asc(scenes.slug));
    if (rows.length === 0) return [];

    const counts = (await db.execute(sql`
      SELECT lower(st.tag) AS tag, COUNT(DISTINCT st.space_id)::int AS count
      FROM app.space_tags st
      JOIN app.spaces s ON s.id = st.space_id
      WHERE s.listed = true
      GROUP BY lower(st.tag)
    `)) as unknown as Array<{ tag: string; count: number }>;

    const countByTag = new Map(counts.map((r) => [r.tag, r.count]));

    return rows.map((scene) => ({
      ...scene,
      // Upper bound, not exact: a space carrying two of the scene's tags is
      // counted twice. Cheap enough for a "does this rail have anything" hint.
      spaceCount: scene.tags.reduce((sum, t) => sum + (countByTag.get(t.toLowerCase()) ?? 0), 0),
    }));
  },

  // ── Space → music join ──────────────────────────────────────────

  /**
   * Music arriving through community: tracks and albums published by people who
   * run or belong to a **listed** space, annotated with the space they came
   * through so a client can render "via <space>" instead of a flat global chart.
   *
   * SECURITY — why this is not literally "music h-tagged to a listed space":
   * an `h` tag makes a music event space-scoped, and the relay serves those only
   * to members (see relay/src/db/event_store.rs visibility gating). Listing a
   * space makes it *discoverable*, never *publicly readable*, so joining on
   * `h_tag = <listed space>` and serving the result to guests would leak
   * space-exclusive uploads. This route therefore only ever returns events with
   * no `h` tag and no `visibility` tag — the same bar `/music/browse` applies —
   * and derives the space link from authorship instead.
   */
  async getListedSpaceMusic(opts: {
    sort?: "recent" | "trending";
    limit?: number;
    /** Candidate pool size scanned before ranking. */
    poolSize?: number;
  }) {
    const limit = Math.min(opts.limit ?? 20, 100);
    const poolSize = Math.min(Math.max(opts.poolSize ?? 500, limit), 1000);

    // Each author's most prominent listed space (highest discovery score),
    // covering both creators and members.
    const authorSpaces = (await db.execute(sql`
      SELECT DISTINCT ON (a.pubkey)
        a.pubkey, s.id AS space_id, s.name AS space_name, s.picture AS space_picture
      FROM (
        SELECT creator_pubkey AS pubkey, id AS space_id
        FROM app.spaces WHERE listed = true AND creator_pubkey IS NOT NULL
        UNION
        SELECT sm.pubkey, sm.space_id
        FROM app.space_members sm
        JOIN app.spaces s2 ON s2.id = sm.space_id AND s2.listed = true
      ) a
      JOIN app.spaces s ON s.id = a.space_id
      ORDER BY a.pubkey, s.discovery_score DESC, s.id
    `)) as unknown as Array<{
      pubkey: string;
      space_id: string;
      space_name: string;
      space_picture: string | null;
    }>;

    if (authorSpaces.length === 0) return { tracks: [], albums: [] };

    const spaceByAuthor = new Map(authorSpaces.map((r) => [r.pubkey, r]));
    const pubkeyList = sql.join(
      authorSpaces.map((r) => sql`${r.pubkey}`),
      sql`, `,
    );

    // Public music only — h_tag/visibility are the relay's own gate columns, so
    // requiring both NULL is the identical bar to /music/browse's post-filter.
    const rows = (await db.execute(sql`
      SELECT id, pubkey, kind, tags, content, created_at, sig
      FROM relay.events
      WHERE kind IN (31683, 33123)
        AND pubkey IN (${pubkeyList})
        AND h_tag IS NULL
        AND visibility IS NULL
      ORDER BY created_at DESC
      LIMIT ${poolSize}
    `)) as unknown as Array<{
      id: string;
      pubkey: string;
      kind: number;
      tags: string[][];
      content: string;
      created_at: number;
      sig: string;
    }>;

    if (rows.length === 0) return { tracks: [], albums: [] };

    const decorated = rows.map((r) => {
      const space = spaceByAuthor.get(r.pubkey);
      return {
        ...r,
        created_at: Number(r.created_at),
        space: space
          ? { id: space.space_id, name: space.space_name, picture: space.space_picture }
          : null,
      };
    });

    let tracks = decorated.filter((e) => e.kind === 31683);
    let albums = decorated.filter((e) => e.kind === 33123);

    if (opts.sort === "trending") {
      [tracks, albums] = await Promise.all([
        rankByTrending(tracks, "trending:music:tracks"),
        rankByTrending(albums, "trending:music:albums"),
      ]);
    }

    return { tracks: tracks.slice(0, limit), albums: albums.slice(0, limit) };
  },

  // ── Listing requests ────────────────────────────────────────────

  async submitListingRequest(params: {
    spaceId: string;
    requesterPubkey: string;
    category?: string;
    tags?: string[];
    reason?: string;
  }) {
    const isAdmin = config.adminPubkeys.includes(params.requesterPubkey);

    // Check if space exists
    const space = await db
      .select()
      .from(spaces)
      .where(eq(spaces.id, params.spaceId))
      .limit(1);

    if (space.length === 0) {
      throw new Error("Space not found");
    }

    // Check if already listed
    if (space[0].listed) {
      throw new Error("Space is already listed");
    }

    // Check pending request
    const existing = await db
      .select()
      .from(listingRequests)
      .where(and(
        eq(listingRequests.spaceId, params.spaceId),
        eq(listingRequests.status, "pending"),
      ))
      .limit(1);

    if (existing.length > 0) {
      throw new Error("A pending listing request already exists for this space");
    }

    // Admin bypass: auto-approve regardless of member count
    if (isAdmin) {
      const id = crypto.randomUUID();
      await db.insert(listingRequests).values({
        id,
        spaceId: params.spaceId,
        requesterPubkey: params.requesterPubkey,
        status: "approved",
        category: params.category,
        tags: params.tags,
        reason: params.reason,
        reviewerPubkey: params.requesterPubkey,
        reviewNote: "Auto-approved (admin)",
        reviewedAt: new Date(),
      });

      // Update space
      await db
        .update(spaces)
        .set({
          listed: true,
          listedAt: new Date(),
          category: params.category ?? space[0].category,
        })
        .where(eq(spaces.id, params.spaceId));

      // Add tags
      if (params.tags && params.tags.length > 0) {
        for (const tag of params.tags) {
          await db.insert(spaceTags).values({
            id: crypto.randomUUID(),
            spaceId: params.spaceId,
            tag,
          }).onConflictDoNothing();
        }
      }

      return { id, status: "approved" as const };
    }

    // Non-admin: check member count threshold
    if (space[0].memberCount < config.minListingMembers) {
      throw new Error(
        `Space must have at least ${config.minListingMembers} members to request listing`,
      );
    }

    // Auto-approve if space meets high thresholds (20+ members, 7+ days old)
    const ageInDays = (Date.now() - space[0].createdAt * 1000) / (1000 * 60 * 60 * 24);
    const autoApprove = space[0].memberCount >= 20 && ageInDays >= 7;

    const id = crypto.randomUUID();
    const status = autoApprove ? "approved" : "pending";

    await db.insert(listingRequests).values({
      id,
      spaceId: params.spaceId,
      requesterPubkey: params.requesterPubkey,
      status,
      category: params.category,
      tags: params.tags,
      reason: params.reason,
      ...(autoApprove
        ? {
            reviewerPubkey: "system",
            reviewNote: "Auto-approved (met thresholds)",
            reviewedAt: new Date(),
          }
        : {}),
    });

    if (autoApprove) {
      await db
        .update(spaces)
        .set({
          listed: true,
          listedAt: new Date(),
          category: params.category ?? space[0].category,
        })
        .where(eq(spaces.id, params.spaceId));

      if (params.tags && params.tags.length > 0) {
        for (const tag of params.tags) {
          await db.insert(spaceTags).values({
            id: crypto.randomUUID(),
            spaceId: params.spaceId,
            tag,
          }).onConflictDoNothing();
        }
      }
    }

    return { id, status };
  },

  async getListingRequests(pubkey: string) {
    const isAdmin = config.adminPubkeys.includes(pubkey);

    if (isAdmin) {
      return db
        .select()
        .from(listingRequests)
        .orderBy(desc(listingRequests.createdAt))
        .limit(100);
    }

    return db
      .select()
      .from(listingRequests)
      .where(eq(listingRequests.requesterPubkey, pubkey))
      .orderBy(desc(listingRequests.createdAt))
      .limit(50);
  },

  async reviewListingRequest(params: {
    requestId: string;
    reviewerPubkey: string;
    status: "approved" | "rejected";
    reviewNote?: string;
  }) {
    if (!config.adminPubkeys.includes(params.reviewerPubkey)) {
      throw new Error("Only platform admins can review listing requests");
    }

    const request = await db
      .select()
      .from(listingRequests)
      .where(eq(listingRequests.id, params.requestId))
      .limit(1);

    if (request.length === 0) {
      throw new Error("Listing request not found");
    }

    if (request[0].status !== "pending") {
      throw new Error("Listing request has already been reviewed");
    }

    await db
      .update(listingRequests)
      .set({
        status: params.status,
        reviewerPubkey: params.reviewerPubkey,
        reviewNote: params.reviewNote,
        reviewedAt: new Date(),
      })
      .where(eq(listingRequests.id, params.requestId));

    if (params.status === "approved") {
      await db
        .update(spaces)
        .set({
          listed: true,
          listedAt: new Date(),
          category: request[0].category ?? undefined,
        })
        .where(eq(spaces.id, request[0].spaceId));

      if (request[0].tags && request[0].tags.length > 0) {
        for (const tag of request[0].tags) {
          await db.insert(spaceTags).values({
            id: crypto.randomUUID(),
            spaceId: request[0].spaceId,
            tag,
          }).onConflictDoNothing();
        }
      }
    }

    return { requestId: params.requestId, status: params.status };
  },

  // ── Relay directory ─────────────────────────────────────────────

  async getRelays(opts: {
    sort?: "popular" | "fastest" | "newest";
    nip?: number;
    search?: string;
    limit?: number;
  }) {
    const limit = Math.min(opts.limit ?? 20, 100);

    const conditions: ReturnType<typeof eq>[] = [];

    if (opts.search) {
      conditions.push(
        sql`(${relayDirectory.url} ILIKE ${"%" + opts.search + "%"} OR ${relayDirectory.name} ILIKE ${"%" + opts.search + "%"})` as any,
      );
    }

    if (opts.nip) {
      conditions.push(
        sql`${opts.nip} = ANY(${relayDirectory.supportedNips})` as any,
      );
    }

    let orderBy;
    switch (opts.sort) {
      case "fastest":
        orderBy = asc(relayDirectory.rttMs);
        break;
      case "newest":
        orderBy = desc(relayDirectory.createdAt);
        break;
      case "popular":
      default:
        orderBy = desc(relayDirectory.userCount);
        break;
    }

    if (conditions.length > 0) {
      return db
        .select()
        .from(relayDirectory)
        .where(and(...conditions))
        .orderBy(orderBy)
        .limit(limit);
    }

    return db
      .select()
      .from(relayDirectory)
      .orderBy(orderBy)
      .limit(limit);
  },

  // ── Zap rollup ──────────────────────────────────────────────────

  /**
   * Recompute each listed space's trailing-24h zap totals.
   *
   * Zaps are per-event on Nostr; a space's funding signal is the sum over
   * events whose `h` tag is that space. Redis holds all-time per-event totals
   * (`zap_total:<id>`), which can't answer "last 24 hours", so this reads the
   * receipts themselves out of relay.events and re-derives the window.
   *
   * Wholesale recompute (every space reset to 0 first) rather than an
   * incremental counter: a replayed or re-ingested receipt then can't inflate a
   * space permanently, and the window rolls forward on its own.
   */
  async rollupSpaceZaps(windowHours = 24, maxReceipts = 20_000) {
    const since = Math.floor(Date.now() / 1000) - windowHours * 3600;

    // Zap receipts in-window, joined to the event they paid for. `e_tags` is the
    // indexed array column the relay extracts at insert time (GIN), so this
    // avoids unnesting the tags JSONB.
    const rows = (await db.execute(sql`
      SELECT target.h_tag AS space_id, zap.tags AS tags
      FROM relay.events zap
      JOIN relay.events target ON target.id = ANY(zap.e_tags)
      WHERE zap.kind = 9735
        AND zap.created_at >= ${since}
        AND target.h_tag IS NOT NULL
      LIMIT ${maxReceipts}
    `)) as unknown as Array<{ space_id: string; tags: string[][] }>;

    const rollup = new Map<string, { count: number; sats: number }>();
    for (const row of rows) {
      const entry = rollup.get(row.space_id) ?? { count: 0, sats: 0 };
      entry.count += 1;
      entry.sats += parseZapSats(row.tags ?? []);
      rollup.set(row.space_id, entry);
    }

    // Reset first so spaces whose zaps aged out of the window fall back to 0.
    await db.execute(sql`
      UPDATE app.spaces SET zap_count_24h = 0, zap_sats_24h = 0
      WHERE zap_count_24h <> 0 OR zap_sats_24h <> 0
    `);

    if (rollup.size === 0) return { spaces: 0, receipts: rows.length };

    const values = sql.join(
      [...rollup.entries()].map(
        ([spaceId, v]) => sql`(${spaceId}, ${v.count}::int, ${v.sats}::bigint)`,
      ),
      sql`, `,
    );

    await db.execute(sql`
      UPDATE app.spaces s
      SET zap_count_24h = v.zap_count, zap_sats_24h = v.zap_sats
      FROM (VALUES ${values}) AS v(space_id, zap_count, zap_sats)
      WHERE s.id = v.space_id
    `);

    return { spaces: rollup.size, receipts: rows.length };
  },

  // ── Discovery score computation ─────────────────────────────────

  async computeDiscoveryScores() {
    await db.execute(sql`
      UPDATE app.spaces
      SET discovery_score = ROUND(
        COALESCE(member_count, 0) * 2 +
        COALESCE(active_members_24h, 0) * 5 +
        COALESCE(messages_last_24h, 0) +
        -- Funding signal. Count is weighted heavily (many small zaps = a room
        -- full of people who show up), while sats enter logarithmically at the
        -- same coefficient the trending computer uses — so a single whale zap
        -- cannot outrank a room that a dozen people funded.
        COALESCE(zap_count_24h, 0) * 10 +
        CASE
          WHEN COALESCE(zap_sats_24h, 0) > 0 THEN LOG(2, zap_sats_24h::numeric) * 2
          ELSE 0
        END +
        CASE
          WHEN created_at > EXTRACT(epoch FROM NOW() - INTERVAL '7 days') THEN 50
          WHEN created_at > EXTRACT(epoch FROM NOW() - INTERVAL '30 days') THEN 20
          ELSE 0
        END
      )::int
      WHERE listed = true
    `);
  },

  /** Auto-delist spaces that have been inactive */
  async autoDelistInactive() {
    await db.execute(sql`
      UPDATE app.spaces
      SET listed = false
      WHERE listed = true
        AND messages_last_24h = 0
        AND active_members_24h = 0
        AND member_count < 3
        AND listed_at < NOW() - INTERVAL '30 days'
    `);
  },
};
