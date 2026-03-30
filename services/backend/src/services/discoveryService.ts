import { eq, desc, asc, and, sql } from "drizzle-orm";
import { db } from "../db/connection.js";
import { spaces, spaceTags } from "../db/schema/spaces.js";
import { listingRequests, spaceCategories, relayDirectory } from "../db/schema/discovery.js";
import { config } from "../config.js";
import crypto from "crypto";

export const discoveryService = {
  // ── Space discovery ──────────────────────────────────────────────

  async getListedSpaces(opts: {
    category?: string;
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

    // Attach tags
    const spaceIds = results.map((s) => s.id);
    if (spaceIds.length > 0) {
      const tags = await db
        .select()
        .from(spaceTags)
        .where(sql`${spaceTags.spaceId} = ANY(${spaceIds})`);

      const tagMap = new Map<string, string[]>();
      for (const t of tags) {
        if (!tagMap.has(t.spaceId)) tagMap.set(t.spaceId, []);
        tagMap.get(t.spaceId)!.push(t.tag);
      }

      // Filter by tag if requested
      if (opts.tag) {
        const matchingIds = new Set(
          tags.filter((t) => t.tag === opts.tag).map((t) => t.spaceId),
        );
        return results
          .filter((s) => matchingIds.has(s.id))
          .map((s) => ({ ...s, tags: tagMap.get(s.id) ?? [] }));
      }

      return results.map((s) => ({ ...s, tags: tagMap.get(s.id) ?? [] }));
    }

    return results.map((s) => ({ ...s, tags: [] as string[] }));
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

  // ── Discovery score computation ─────────────────────────────────

  async computeDiscoveryScores() {
    await db.execute(sql`
      UPDATE app.spaces
      SET discovery_score = (
        COALESCE(member_count, 0) * 2 +
        COALESCE(active_members_24h, 0) * 5 +
        COALESCE(messages_last_24h, 0) +
        CASE
          WHEN created_at > EXTRACT(epoch FROM NOW() - INTERVAL '7 days') THEN 50
          WHEN created_at > EXTRACT(epoch FROM NOW() - INTERVAL '30 days') THEN 20
          ELSE 0
        END
      )
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
