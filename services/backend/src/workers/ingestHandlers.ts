import { db } from "../db/connection.js";
import { profileCacheService } from "../services/profileCacheService.js";
import { spaceMembers } from "../db/schema/members.js";
import { spaces } from "../db/schema/spaces.js";
import { spaceActivityDaily, memberEngagement } from "../db/schema/analytics.js";
import { getRedis } from "../lib/redis.js";
import { getMeilisearchClient } from "../lib/meilisearch.js";
import { verifyEvent } from "../lib/nostr/eventVerifier.js";
import { enqueueNotification } from "../services/notificationEnqueue.js";
import { revisionService } from "../services/revisionService.js";
import { proposalService } from "../services/proposalService.js";
import { eq, and, sql } from "drizzle-orm";

/**
 * Per-event ingestion context (Decentralized Spaces, M3). The multi-relay
 * manager builds one per connection so handlers know how much to trust the source.
 */
export interface IngestContext {
  relayUrl: string;
  /** Whether this is our own platform relay (config.relayUrl). */
  isOwnRelay: boolean;
  /** Space ids this relay is allowed to affect; null = all (own relay only). */
  allowedSpaceIds: Set<string> | null;
  /** The relay's NIP-11 signing key (external relays) — required to trust 39000/39002. */
  relayPubkey?: string;
}

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

const redis = getRedis();

/** Escape a string for use in Meilisearch filter expressions */
function escapeMsFilter(value: string): string {
  return value.replace(/[\\"]/g, "");
}

function getTagValue(event: NostrEvent, name: string): string | undefined {
  const tag = event.tags.find((t) => t[0] === name);
  return tag?.[1];
}

function isNonPublicEvent(event: NostrEvent): boolean {
  const vis = getTagValue(event, "visibility");
  return vis === "unlisted" || vis === "private" || !!getTagValue(event, "h");
}

function today(): string {
  return new Date().toISOString().split("T")[0];
}

/** Is a space id (from an h or d tag) one this relay may affect? */
function scopeAllows(ctx: IngestContext, spaceId: string | undefined): boolean {
  if (ctx.allowedSpaceIds === null) return true; // own relay: all spaces
  return spaceId != null && ctx.allowedSpaceIds.has(spaceId);
}

/** Trust 39000/39002 only from the relay's own signing key (NIP-29 authority). */
function metadataAuthored(ctx: IngestContext, event: NostrEvent): boolean {
  if (ctx.isOwnRelay) return true;
  return !!ctx.relayPubkey && event.pubkey === ctx.relayPubkey;
}

/** Which indexer (if any) an event maps to under a trust context. */
export type IngestAction =
  | "profile"
  | "reaction"
  | "chat"
  | "zap"
  | "join"
  | "leave"
  | "groupMetadata"
  | "groupMembers"
  | "musicTrack"
  | "musicAlbum"
  | "proposal"
  | "deletion"
  | null;

export interface IngestPlan {
  action: IngestAction;
  /** Whether to add the event to the Meilisearch `events` index. */
  indexSearch: boolean;
}

const SEARCHABLE_KINDS = [1, 9, 22, 30023, 34236, 30119];

/**
 * PURE trust + routing decision — no side effects, so the security gates (own-relay
 * gate, allowedSpaceIds anti-poisoning, relay-key metadata authority) are
 * exhaustively unit-testable. `processEvent` dispatches on the result.
 */
export function planIngest(event: NostrEvent, ctx: IngestContext): IngestPlan {
  const action = decideAction(event, ctx);

  // Own relay indexes all public content kinds (today's behavior); an external
  // relay only contributes the h-tagged chat it's scoped to.
  const indexSearch = SEARCHABLE_KINDS.includes(event.kind)
    ? ctx.isOwnRelay || (event.kind === 9 && scopeAllows(ctx, getTagValue(event, "h")))
    : false;

  return { action, indexSearch };
}

function decideAction(event: NostrEvent, ctx: IngestContext): IngestAction {
  switch (event.kind) {
    // Global kinds — own relay ONLY (a foreign relay must not be able to poison
    // the global profile / music / zap / deletion paths).
    case 0:
      return ctx.isOwnRelay ? "profile" : null;
    case 9735:
      return ctx.isOwnRelay ? "zap" : null;
    case 31683:
      return ctx.isOwnRelay ? "musicTrack" : null;
    case 33123:
      return ctx.isOwnRelay ? "musicAlbum" : null;
    case 31685:
      return ctx.isOwnRelay ? "proposal" : null;
    case 5:
      return ctx.isOwnRelay ? "deletion" : null;

    // Space-scoped kinds — gated by allowedSpaceIds.
    case 7:
      return scopeAllows(ctx, getTagValue(event, "h")) ? "reaction" : null;
    case 9:
      return scopeAllows(ctx, getTagValue(event, "h")) ? "chat" : null;

    // Membership writes to app.space_members — own relay ONLY (a foreign relay's
    // 9021/9022 must not forge platform/A-lite membership).
    case 9021:
      return ctx.isOwnRelay && scopeAllows(ctx, getTagValue(event, "h")) ? "join" : null;
    case 9022:
      return ctx.isOwnRelay && scopeAllows(ctx, getTagValue(event, "h")) ? "leave" : null;

    // Relay-signed group state — trusted only from the relay's own key.
    case 39000:
      return scopeAllows(ctx, getTagValue(event, "d")) && metadataAuthored(ctx, event)
        ? "groupMetadata"
        : null;
    case 39002:
      return scopeAllows(ctx, getTagValue(event, "d")) && metadataAuthored(ctx, event)
        ? "groupMembers"
        : null;

    default:
      return null;
  }
}

/**
 * Route a verified event to the right indexer, applying the trust context
 * computed by {@link planIngest}.
 */
export async function processEvent(event: NostrEvent, ctx: IngestContext): Promise<void> {
  if (!verifyEvent(event)) return;

  const { action, indexSearch } = planIngest(event, ctx);

  switch (action) {
    case "profile":
      await indexProfile(event);
      break;
    case "zap":
      await indexZapReceipt(event);
      break;
    case "musicTrack":
      await indexMusicTrack(event);
      break;
    case "musicAlbum":
      await indexMusicAlbum(event);
      break;
    case "proposal":
      await indexProposal(event);
      break;
    case "deletion":
      await processDeletion(event);
      break;
    case "reaction":
      await indexReaction(event);
      break;
    case "chat":
      await indexChatMessage(event);
      break;
    case "join":
      await indexJoin(event);
      break;
    case "leave":
      await indexLeave(event);
      break;
    case "groupMetadata":
      await indexGroupMetadata(event);
      break;
    case "groupMembers":
      await indexGroupMembers(event);
      break;
    case null:
      break;
  }

  if (indexSearch) await indexToMeilisearch(event);
}

async function indexProfile(event: NostrEvent) {
  const result = await profileCacheService.upsert({
    pubkey: event.pubkey,
    createdAt: event.created_at,
    content: event.content,
  });
  if (!result || !result.applied) return;

  const { profile } = result;
  const ms = getMeilisearchClient();
  await ms.index("profiles").addDocuments([
    {
      pubkey: event.pubkey,
      name: profile.name,
      display_name: profile.displayName,
      about: profile.about,
      nip05: profile.nip05,
      picture: profile.picture,
    },
  ]);
}

async function indexChatMessage(event: NostrEvent) {
  const spaceId = getTagValue(event, "h");
  if (!spaceId) return;

  const date = today();

  await db
    .insert(spaceActivityDaily)
    .values({ spaceId, date, messageCount: 1, uniqueAuthors: 1, newMembers: 0, leftMembers: 0 })
    .onConflictDoUpdate({
      target: [spaceActivityDaily.spaceId, spaceActivityDaily.date],
      set: { messageCount: sql`${spaceActivityDaily.messageCount} + 1` },
    });

  await db
    .insert(memberEngagement)
    .values({ spaceId, pubkey: event.pubkey, date, messageCount: 1, reactionsGiven: 0, reactionsReceived: 0 })
    .onConflictDoUpdate({
      target: [memberEngagement.spaceId, memberEngagement.pubkey, memberEngagement.date],
      set: { messageCount: sql`${memberEngagement.messageCount} + 1` },
    });

  const mentionedPubkeys = event.tags
    .filter((t) => t[0] === "p" && t[1] !== event.pubkey)
    .map((t) => t[1]);

  const cleanContent = event.content
    .replace(/nostr:(npub|nevent|naddr|note)1[a-z0-9]+/g, "@mention")
    .replace(/\s{2,}/g, " ")
    .trim();
  const preview = cleanContent.length > 120 ? cleanContent.slice(0, 120) + "..." : cleanContent;

  for (const pubkey of mentionedPubkeys) {
    enqueueNotification({
      pubkey,
      type: "mention",
      title: "You were mentioned",
      body: preview,
      data: { spaceId, eventId: event.id },
    });
  }
}

async function indexReaction(event: NostrEvent) {
  const targetEventId = getTagValue(event, "e");
  if (!targetEventId) return;

  const spaceId = getTagValue(event, "h");
  if (!spaceId) return;

  const date = today();
  const targetPubkey = getTagValue(event, "p");

  await db
    .insert(memberEngagement)
    .values({ spaceId, pubkey: event.pubkey, date, messageCount: 0, reactionsGiven: 1, reactionsReceived: 0 })
    .onConflictDoUpdate({
      target: [memberEngagement.spaceId, memberEngagement.pubkey, memberEngagement.date],
      set: { reactionsGiven: sql`${memberEngagement.reactionsGiven} + 1` },
    });

  if (targetPubkey) {
    await db
      .insert(memberEngagement)
      .values({ spaceId, pubkey: targetPubkey, date, messageCount: 0, reactionsGiven: 0, reactionsReceived: 1 })
      .onConflictDoUpdate({
        target: [memberEngagement.spaceId, memberEngagement.pubkey, memberEngagement.date],
        set: { reactionsReceived: sql`${memberEngagement.reactionsReceived} + 1` },
      });
  }
}

async function indexZapReceipt(event: NostrEvent) {
  const targetEventId = getTagValue(event, "e");
  if (!targetEventId) return;

  let sats = 0;
  const bolt11Tag = event.tags.find((t) => t[0] === "bolt11");
  if (bolt11Tag?.[1]) {
    const descTag = event.tags.find((t) => t[0] === "description");
    if (descTag?.[1]) {
      try {
        const desc = JSON.parse(descTag[1]);
        const amountTag = desc.tags?.find((t: string[]) => t[0] === "amount");
        if (amountTag?.[1]) sats = Math.floor(parseInt(amountTag[1], 10) / 1000);
      } catch {
        // ignore
      }
    }
  }

  await redis.incrby(`zap_total:${targetEventId}`, sats);
  await redis.incr(`zap_count:${targetEventId}`);
}

async function indexJoin(event: NostrEvent) {
  const spaceId = getTagValue(event, "h");
  if (!spaceId) return;

  await db.insert(spaceMembers).values({ spaceId, pubkey: event.pubkey }).onConflictDoNothing();
}

async function indexLeave(event: NostrEvent) {
  const spaceId = getTagValue(event, "h");
  if (!spaceId) return;

  await db
    .delete(spaceMembers)
    .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.pubkey, event.pubkey)));
}

async function indexGroupMetadata(event: NostrEvent) {
  const groupId = getTagValue(event, "d");
  if (!groupId) return;

  // Prefer tags (NIP-29), fall back to a JSON content blob.
  let name = getTagValue(event, "name");
  let picture = getTagValue(event, "picture");
  let about = getTagValue(event, "about");
  if (!name || !picture || !about) {
    try {
      const meta = JSON.parse(event.content);
      name = name ?? meta.name;
      picture = picture ?? meta.picture;
      about = about ?? meta.about;
    } catch {
      // not JSON
    }
  }

  await db
    .update(spaces)
    .set({ name: name ?? groupId, picture: picture ?? null, about: about ?? null })
    .where(eq(spaces.id, groupId));
}

/**
 * Mirror a NIP-29 group's member count (kind:39002 p-tags) into
 * `mirrored_member_count` — kept SEPARATE from app.space_members so foreign
 * 39002 data never affects the Rust relay's membership gating.
 */
async function indexGroupMembers(event: NostrEvent) {
  const groupId = getTagValue(event, "d");
  if (!groupId) return;
  const count = event.tags.filter((t) => t[0] === "p" && t[1]).length;
  await db.update(spaces).set({ mirroredMemberCount: count }).where(eq(spaces.id, groupId));
}

async function indexMusicTrack(event: NostrEvent) {
  if (isNonPublicEvent(event)) return;

  const ms = getMeilisearchClient();
  const title = getTagValue(event, "title");
  const artist = getTagValue(event, "artist");
  const genre = getTagValue(event, "genre");
  const dTag = getTagValue(event, "d") ?? "";
  const imageUrl = getTagValue(event, "image") ?? getTagValue(event, "thumb") ?? "";
  const hashtags = event.tags.filter((t) => t[0] === "t").map((t) => t[1]);

  const pTags = event.tags.filter((t) => t[0] === "p" && t[1]);
  const hasRoles = pTags.some((t) => t[3]);
  const artistPubkeys = hasRoles ? pTags.filter((t) => t[3] === "artist").map((t) => t[1]) : [];
  const featuredPubkeys = hasRoles
    ? pTags.filter((t) => t[3] === "featured").map((t) => t[1])
    : pTags.filter((t) => t[1] !== event.pubkey).map((t) => t[1]);

  await ms.index("tracks").addDocuments([
    {
      id: event.id,
      addressable_id: `31683:${event.pubkey}:${dTag}`,
      title: title ?? "",
      artist: artist ?? "",
      genre: genre ?? "",
      image_url: imageUrl,
      hashtags,
      pubkey: event.pubkey,
      artist_pubkeys: artistPubkeys,
      featured_pubkeys: featuredPubkeys,
      created_at: event.created_at,
    },
  ]);

  const wasNew = await redis.sadd("music:counted_events", event.id);
  if (wasNew) {
    const pipeline = redis.pipeline();
    if (genre) pipeline.zincrby("music:genre_counts", 1, genre);
    for (const tag of hashtags) pipeline.zincrby("music:tag_counts", 1, tag);
    if (genre || hashtags.length > 0) await pipeline.exec();
  }

  try {
    await revisionService.captureRevision(`31683:${event.pubkey}:${dTag}`, event);
  } catch (err) {
    console.error("[ingester] Failed to capture track revision:", (err as Error).message);
  }
}

async function indexMusicAlbum(event: NostrEvent) {
  if (isNonPublicEvent(event)) return;

  const ms = getMeilisearchClient();
  const title = getTagValue(event, "title");
  const artist = getTagValue(event, "artist");
  const genre = getTagValue(event, "genre");
  const dTag = getTagValue(event, "d") ?? "";
  const imageUrl = getTagValue(event, "image") ?? getTagValue(event, "thumb") ?? "";
  const hashtags = event.tags.filter((t) => t[0] === "t").map((t) => t[1]);

  const pTags = event.tags.filter((t) => t[0] === "p" && t[1]);
  const hasRoles = pTags.some((t) => t[3]);
  const artistPubkeys = hasRoles ? pTags.filter((t) => t[3] === "artist").map((t) => t[1]) : [];
  const featuredPubkeys = hasRoles
    ? pTags.filter((t) => t[3] === "featured").map((t) => t[1])
    : pTags.filter((t) => t[1] !== event.pubkey).map((t) => t[1]);

  await ms.index("albums").addDocuments([
    {
      id: event.id,
      addressable_id: `33123:${event.pubkey}:${dTag}`,
      title: title ?? "",
      artist: artist ?? "",
      genre: genre ?? "",
      image_url: imageUrl,
      hashtags,
      pubkey: event.pubkey,
      artist_pubkeys: artistPubkeys,
      featured_pubkeys: featuredPubkeys,
      created_at: event.created_at,
    },
  ]);

  const wasNew = await redis.sadd("music:counted_events", event.id);
  if (wasNew) {
    const pipeline = redis.pipeline();
    if (genre) pipeline.zincrby("music:genre_counts", 1, genre);
    for (const tag of hashtags) pipeline.zincrby("music:tag_counts", 1, tag);
    if (genre || hashtags.length > 0) await pipeline.exec();
  }

  try {
    await revisionService.captureRevision(`33123:${event.pubkey}:${dTag}`, event);
  } catch (err) {
    console.error("[ingester] Failed to capture album revision:", (err as Error).message);
  }

  try {
    await db.execute(
      sql`UPDATE app.saved_album_versions SET has_update = true WHERE addressable_id = ${`33123:${event.pubkey}:${dTag}`}`,
    );
  } catch (err) {
    console.error("[ingester] Failed to flag saved versions:", (err as Error).message);
  }
}

async function indexProposal(event: NostrEvent) {
  try {
    await proposalService.indexProposal(event);
  } catch (err) {
    console.error("[ingester] Failed to index proposal:", (err as Error).message);
  }
}

async function processDeletion(event: NostrEvent) {
  const ms = getMeilisearchClient();

  const dedupeKey = `ingester:deletion:${event.id}`;
  const alreadyProcessed = await redis.get(dedupeKey);
  if (alreadyProcessed) return;
  await redis.set(dedupeKey, "1", "EX", 604800);

  for (const tag of event.tags) {
    if (tag[0] !== "a" || !tag[1]) continue;
    const addr = tag[1];
    const [kindStr, addrPubkey, ...dParts] = addr.split(":");
    const dTag = dParts.join(":");
    if (addrPubkey !== event.pubkey) continue;
    const kind = parseInt(kindStr, 10);

    if (kind === 31683 || kind === 33123) {
      const index = kind === 31683 ? "tracks" : "albums";
      try {
        await db.execute(
          sql`DELETE FROM relay.events
              WHERE kind = ${kind}
                AND pubkey = ${addrPubkey}
                AND tags @> ${JSON.stringify([["d", dTag]])}::jsonb
                AND created_at <= ${event.created_at}`,
        );
      } catch (err) {
        console.error(`[ingester] Failed to delete ${index} from relay DB:`, err);
      }
      try {
        const results = await ms.index(index).search("", {
          filter: `pubkey = "${escapeMsFilter(addrPubkey)}"`,
          limit: 100,
        });
        const matchingHits = results.hits.filter(
          (h: Record<string, unknown>) =>
            h.addressable_id === addr && (h.created_at as number) <= event.created_at,
        );
        const docIds = matchingHits.map((h: Record<string, unknown>) => h.id as string);
        if (docIds.length > 0) {
          await ms.index(index).deleteDocuments(docIds);
          for (const h of matchingHits) {
            const hGenre = h.genre as string;
            const hTags = (h.hashtags as string[]) ?? [];
            if (hGenre) await redis.zincrby("music:genre_counts", -1, hGenre);
            for (const t of hTags) await redis.zincrby("music:tag_counts", -1, t);
            await redis.srem("music:counted_events", h.id as string);
          }
          await redis.zremrangebyscore("music:genre_counts", "-inf", "0");
          await redis.zremrangebyscore("music:tag_counts", "-inf", "0");
        }
      } catch (err) {
        console.error(`[ingester] Failed to delete ${index} from Meilisearch:`, err);
      }
    }

    try {
      await revisionService.deleteRevisions(addr);
    } catch {
      /* non-fatal */
    }
    try {
      await db.execute(sql`DELETE FROM app.saved_album_versions WHERE addressable_id = ${addr}`);
    } catch {
      /* non-fatal */
    }
  }

  for (const tag of event.tags) {
    if (tag[0] !== "e" || !tag[1]) continue;
    try {
      const rows = (await db.execute(
        sql`SELECT pubkey FROM relay.events WHERE id = ${tag[1]} LIMIT 1`,
      )) as unknown as { pubkey: string }[];
      if (rows.length > 0 && rows[0].pubkey === event.pubkey) {
        await ms.index("events").deleteDocument(tag[1]);
      }
    } catch {
      // doc may not exist
    }
  }
}

async function indexToMeilisearch(event: NostrEvent) {
  const ms = getMeilisearchClient();
  await ms.index("events").addDocuments([
    {
      id: event.id,
      kind: event.kind,
      pubkey: event.pubkey,
      content: event.content,
      created_at: event.created_at,
      tags: event.tags,
    },
  ]);
}
