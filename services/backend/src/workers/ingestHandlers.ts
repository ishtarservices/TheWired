import { config } from "../config.js";
import { db } from "../db/connection.js";
import { profileCacheService } from "../services/profileCacheService.js";
import { spaceMembers } from "../db/schema/members.js";
import { spaces } from "../db/schema/spaces.js";
import { spaceActivityDaily, memberEngagement } from "../db/schema/analytics.js";
import { getRedis } from "../lib/redis.js";
import { getMeilisearchClient } from "../lib/meilisearch.js";
import { verifyEvent } from "../lib/nostr/eventVerifier.js";
import { parseZapSats } from "../lib/nostr/zapAmount.js";
import { enqueueNotification } from "../services/notificationEnqueue.js";
import {
  KIND_GIFT_WRAP,
  planNotifications,
  preview,
  RELEASE_KINDS,
  threadParentId,
  type PlanDeps,
} from "../lib/notifications/planNotifications.js";
import { watchedBy } from "../db/schema/notifications.js";
import { revisionService } from "../services/revisionService.js";
import { proposalService } from "../services/proposalService.js";
import { savedVersionService, addressableIdOf as savedVersionAddress } from "../services/savedVersionService.js";
import { eq, and, sql } from "drizzle-orm";
import { buildMusicSearchDoc } from "../lib/musicSearchDoc.js";
import { escapeMsFilter } from "../lib/meiliFilter.js";
import { isIndexableMusic, isListedPublicMusic } from "../lib/musicListing.js";
import { KIND_REPORT, parseReportEvent } from "../lib/reports/reportInput.js";
import { reportService } from "../services/reportService.js";
import { suspensionService } from "../services/suspensionService.js";
import { accountDeletionService } from "../services/accountDeletionService.js";

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

function getTagValue(event: NostrEvent, name: string): string | undefined {
  const tag = event.tags.find((t) => t[0] === name);
  return tag?.[1];
}

/**
 * Protected shape (docs/MUSIC_VISIBILITY.md): ANY valued `visibility` tag or
 * ANY valued `h` tag. Mirrors the relay's `visibility IS NOT NULL OR h_tag IS
 * NOT NULL` columns and services/musicVisibility.ts, so an unknown visibility
 * value hides rather than exposes and a value-less leading ["h"] cannot mask a
 * later real one.
 */
function isNonPublicEvent(event: NostrEvent): boolean {
  return event.tags.some((t) => (t[0] === "visibility" || t[0] === "h") && !!t[1]);
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
  | "giftWrap"
  | "report"
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

  // The `events` search index backs the unauthenticated GET /search, so only
  // PUBLIC content may enter it: a space-scoped (h) or private/unlisted event
  // is member-/grantee-only on the relay and must not be searchable by anyone.
  // Own relay indexes every public searchable kind; an external relay could
  // only ever contribute h-tagged chat, which is never public, so it indexes
  // nothing.
  const indexSearch =
    SEARCHABLE_KINDS.includes(event.kind) && ctx.isOwnRelay && !isNonPublicEvent(event);

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
    // NIP-59 gift wrap: opaque content, ephemeral author — the only thing we
    // learn is who it is FOR, and the only thing we do is plan a content-free
    // dm push (emitNotifications). Own relay only; never indexed.
    case KIND_GIFT_WRAP:
      return ctx.isOwnRelay ? "giftWrap" : null;
    // NIP-56 report → the moderation queue (app.reports). Own relay only: a
    // foreign relay must not be able to flood the operator's queue.
    case KIND_REPORT:
      return ctx.isOwnRelay ? "report" : null;

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
  if (await authorBlocked(event)) return;

  const { action, indexSearch } = planIngest(event, ctx);

  switch (action) {
    case "profile":
      await indexProfile(event);
      break;
    case "zap":
      await indexZapReceipt(event);
      break;
    case "musicTrack":
      await indexMusicRelease(event, 31683);
      break;
    case "musicAlbum":
      await indexMusicRelease(event, 33123);
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
    case "giftWrap":
      break; // notification-only (see emitNotifications)
    case "report":
      await indexReport(event);
      break;
    case null:
      break;
  }

  if (indexSearch) await indexToMeilisearch(event);

  await emitNotifications(event, ctx);
}

/**
 * Events the platform no longer indexes or pushes for:
 *  - a suspended author's (the relay refuses their new writes; an external
 *    relay or a backfill can still replay old ones) — except kind 5, so a
 *    suspended account's own deletions still clean up search;
 *  - a deleted account's events dated at or before its vanish, and gift wraps
 *    addressed to it (the re-ingest block of the account-deletion tombstone).
 */
export async function authorBlocked(event: NostrEvent): Promise<boolean> {
  if (event.kind !== 5 && (await suspensionService.isSuspended(event.pubkey))) return true;
  const deleted = await accountDeletionService.deletedVanishTimes();
  if (deleted.size === 0) return false;
  const vanishAt = deleted.get(event.pubkey);
  if (vanishAt !== undefined && event.created_at <= vanishAt) return true;
  if (event.kind === KIND_GIFT_WRAP) {
    const recipient = getTagValue(event, "p");
    if (recipient && deleted.has(recipient)) return true;
  }
  return false;
}

async function indexReport(event: NostrEvent) {
  const input = parseReportEvent(event);
  if (!input) return;
  await reportService.file(input);
}

// ─── Push notifications ──────────────────────────────────────────────
// The kinds that can produce a push (lib/notifications/planNotifications).
// Own relay only — planNotifications re-checks, this just skips the lookups.
const NOTIFYING_KINDS = new Set([1, 7, 9735, 9, KIND_GIFT_WRAP, ...RELEASE_KINDS]);

async function relayEvent(
  id: string,
): Promise<{ pubkey: string; content: string; is_public: boolean } | undefined> {
  try {
    // is_public gates what may reach a push BODY: an h-tagged (space-scoped)
    // event's content must never leak to a recipient who may not be a member.
    // The author is still returned so reply detection works for space notes.
    const rows = (await db.execute(
      sql`SELECT pubkey, content, (h_tag IS NULL) AS is_public FROM relay.events WHERE id = ${id} LIMIT 1`,
    )) as unknown as Array<{ pubkey: string; content: string; is_public: boolean }>;
    return rows[0];
  } catch {
    return undefined; // relay schema unavailable → degrade (mention, no preview)
  }
}

/** Gather everything the pure planner needs, each lookup best-effort. */
async function collectPlanDeps(event: NostrEvent): Promise<PlanDeps> {
  const lastE = [...event.tags].reverse().find((t) => t[0] === "e")?.[1];
  const referencedId =
    event.kind === 1 ? threadParentId(event) : event.kind === 7 ? lastE : undefined;
  const referenced = referencedId ? await relayEvent(referencedId) : undefined;

  const namePubkeys = new Set<string>([event.pubkey]);
  if (event.kind === 9735) {
    // Prefetched unconditionally; the planner only USES it after verifying
    // the embedded 9734's signature.
    const description = getTagValue(event, "description");
    if (description) {
      try {
        const req = JSON.parse(description) as { pubkey?: string };
        if (typeof req.pubkey === "string") namePubkeys.add(req.pubkey);
      } catch {
        // malformed — planner drops the receipt
      }
    }
  }
  const names = new Map<string, string>();
  try {
    for (const p of await profileCacheService.getBatchProfiles([...namePubkeys])) {
      const name = p.displayName?.trim() || p.name?.trim();
      if (name) names.set(p.pubkey, name);
    }
  } catch {
    // no names → short handles
  }

  let spaceName: string | undefined;
  // Space mentions (kind:9) and chat reactions (h-tagged kind:7) name the space.
  const spaceId = event.kind === 9 || event.kind === 7 ? getTagValue(event, "h") : undefined;
  if (spaceId) {
    try {
      const [row] = await db.select({ name: spaces.name }).from(spaces).where(eq(spaces.id, spaceId)).limit(1);
      spaceName = row?.name ?? undefined;
    } catch {
      // unknown space → planner's fallback
    }
  }

  let watchers: string[] = [];
  const fansOut = RELEASE_KINDS.has(event.kind) || (event.kind === 1 && !threadParentId(event));
  if (fansOut) {
    try {
      const rows = await db
        .select({ watcher: watchedBy.watcherPubkey })
        .from(watchedBy)
        .where(eq(watchedBy.authorPubkey, event.pubkey));
      watchers = rows.map((r) => r.watcher);
    } catch {
      watchers = [];
    }
  }

  return {
    publicRelayUrl: config.publicRelayUrl,
    parentAuthorOf: (id) => (id === referencedId ? referenced?.pubkey : undefined),
    notePreviewOf: (id) => (id === referencedId && referenced?.is_public ? referenced.content : undefined),
    displayName: (pk) => names.get(pk) ?? `${pk.slice(0, 8)}…`,
    spaceName: () => spaceName,
    watchersOf: () => watchers,
  };
}

/** Was this gift wrap published by its own recipient (the sender's self-wrap)?
 *  The relay records it at ingest from the NIP-42 identity of the publishing
 *  socket (docs/DM_WIRE_CONTRACT.md §7.3) — replaces the client-declared
 *  POST /push/suppress, which taught the server per-message authorship.
 *  Degrades to "not self" so a schema hiccup means one extra push, never a
 *  missed one. */
export async function isSelfPublishedWrap(eventId: string): Promise<boolean> {
  try {
    const rows = (await db.execute(
      sql`SELECT self_published FROM relay.events WHERE id = ${eventId} LIMIT 1`,
    )) as unknown as Array<{ self_published: boolean | null }>;
    return rows[0]?.self_published === true;
  } catch {
    return false;
  }
}

/** Plan + enqueue pushes for one ingested event. Never throws into ingest. */
export async function emitNotifications(event: NostrEvent, ctx: IngestContext): Promise<void> {
  if (!ctx.isOwnRelay || !NOTIFYING_KINDS.has(event.kind)) return;
  try {
    if (event.kind === KIND_GIFT_WRAP && (await isSelfPublishedWrap(event.id))) return;
    const deps = await collectPlanDeps(event);
    const intents = planNotifications(event, ctx, deps);
    for (const intent of intents) {
      await enqueueNotification({
        pubkey: intent.recipient,
        type: intent.type,
        title: intent.title,
        body: intent.body,
        url: intent.url,
        collapseKey: intent.collapseKey,
        data: intent.data,
      });
    }
  } catch (err) {
    console.error("[notifications] emit failed:", (err as Error).message);
  }
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
  // updateDocuments (partial merge), NOT addDocuments (full replace): note_count
  // is owned by profileStatsComputer, and a replace would wipe it on every
  // kind:0 edit, silently collapsing the people ranking to zero.
  await ms.index("profiles").updateDocuments([
    {
      pubkey: event.pubkey,
      name: profile.name,
      display_name: profile.displayName,
      about: profile.about,
      nip05: profile.nip05,
      picture: profile.picture,
      has_nip05: !!profile.nip05,
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

}

/**
 * Live per-member reaction counters.
 *
 * Both columns written here are *provisional*: the daily rollup
 * (analyticsAggregator.runDailyAggregation) recomputes messageCount,
 * reactionsGiven and reactionsReceived wholesale from relay.events and is the
 * authority for the day. These increments only keep the current day's row
 * roughly live between rollups.
 */
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

/**
 * Record one zap receipt against its target, exactly once.
 *
 * `zap_total:` / `zap_count:` are all-time counters read by the trending
 * computer, and this handler runs on every kind:9735 the ingester sees — which
 * is not once per receipt. Relays replay on reconnect, a receipt can arrive
 * from more than one connection, and a backfill re-walks history, so a bare
 * INCR permanently inflates the trending score of whatever the receipt paid
 * for. (The space-level path avoids this by recomputing wholesale instead —
 * see `discoveryService.rollupSpaceZaps`.)
 *
 * The guard is a per-target set of receipt ids: SADD reports whether the id was
 * new, and only a genuinely new receipt moves the counters. The set carries no
 * TTL on purpose: it has to live at least as long as the counters it guards,
 * and those are permanent.
 *
 * Marking before counting means a crash between the two undercounts by one
 * receipt. That is the correct way to fail here: an undercount is bounded and
 * self-limiting, whereas the double-count it replaces compounds without limit.
 *
 * Exported for tests: replaying a receipt must leave both counters untouched.
 */
export async function recordZapReceipt(
  client: ReturnType<typeof getRedis>,
  receiptId: string,
  targetEventId: string,
  sats: number,
): Promise<boolean> {
  const isNew = await client.sadd(`zap_receipts:${targetEventId}`, receiptId);
  if (isNew === 0) return false;

  await client.incrby(`zap_total:${targetEventId}`, sats);
  await client.incr(`zap_count:${targetEventId}`);
  return true;
}

async function indexZapReceipt(event: NostrEvent) {
  const targetEventId = getTagValue(event, "e");
  if (!targetEventId) return;

  await recordZapReceipt(redis, event.id, targetEventId, parseZapSats(event.tags));
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

type MusicIndex = "tracks" | "albums";
type MusicDoc = Record<string, unknown>;

/**
 * processEvent is fire-and-forget per relay message, and every reconnect
 * replays the whole music backfill, so two versions of one release can be in
 * flight at once. Replacing an address's search doc is read-then-write against
 * Meilisearch, so work for one address runs strictly in arrival order. The
 * ingester runs in one process, so an in-process chain is enough.
 */
const musicAddressChains = new Map<string, Promise<unknown>>();

function inAddressOrder<T>(addr: string, work: () => Promise<T>): Promise<T> {
  const run = (musicAddressChains.get(addr) ?? Promise.resolve()).then(work);
  const settled = run.catch(() => undefined);
  musicAddressChains.set(addr, settled);
  void settled.then(() => {
    if (musicAddressChains.get(addr) === settled) musicAddressChains.delete(addr);
  });
  return run;
}

/**
 * Every search doc for one release address. Filters on the address itself
 * rather than scanning the author's first page of docs; a d-tag that
 * escapeMsFilter would alter falls back to the author filter, so the exact
 * compare still finds it.
 */
async function findAddressDocs(index: MusicIndex, addr: string, pubkey: string): Promise<MusicDoc[]> {
  const exact = escapeMsFilter(addr) === addr;
  const results = await getMeilisearchClient()
    .index(index)
    .search("", {
      filter: exact ? `addressable_id = "${addr}"` : `pubkey = "${escapeMsFilter(pubkey)}"`,
      limit: 1000,
    });
  return results.hits.filter((h: MusicDoc) => h.addressable_id === addr);
}

/**
 * Delete search docs and undo the genre/tag counts of the ones that were
 * counted (an unlisted track's doc never was). Safe to repeat: the SREM gate
 * means a doc found twice is only uncounted once.
 */
async function dropMusicDocs(index: MusicIndex, docs: MusicDoc[]) {
  if (docs.length === 0) return;
  await getMeilisearchClient()
    .index(index)
    .deleteDocuments(docs.map((h) => h.id as string));
  for (const h of docs) {
    const wasCounted = await redis.srem("music:counted_events", h.id as string);
    if (!wasCounted) continue;
    const hGenre = h.genre as string;
    const hTags = (h.hashtags as string[]) ?? [];
    if (hGenre) await redis.zincrby("music:genre_counts", -1, hGenre);
    for (const t of hTags) await redis.zincrby("music:tag_counts", -1, t);
  }
  await redis.zremrangebyscore("music:genre_counts", "-inf", "0");
  await redis.zremrangebyscore("music:tag_counts", "-inf", "0");
}

/**
 * Keep exactly one search doc per release address: its newest indexable
 * version. Docs are keyed by event id, so a newer version (an edit, a shared
 * project's owner-set change, a re-sign, a privatize, a moved stub) must drop
 * every older version's doc and undo its counts. Otherwise each public
 * republish leaves another hit behind and counts its genre again. An older
 * version that arrives late changes nothing.
 */
async function syncMusicSearchDocs(event: NostrEvent, kind: 31683 | 33123) {
  const index: MusicIndex = kind === 31683 ? "tracks" : "albums";
  const addr = `${kind}:${event.pubkey}:${getTagValue(event, "d") ?? ""}`;

  await inAddressOrder(addr, async () => {
    try {
      const others = (await findAddressDocs(index, addr, event.pubkey)).filter((h) => h.id !== event.id);
      if (others.some((h) => (h.created_at as number) > event.created_at)) return;
      await dropMusicDocs(index, others);
    } catch (err) {
      console.error(`[ingester] Failed to remove superseded ${index} docs:`, (err as Error).message);
    }

    if (!isIndexableMusic(event.tags)) return;

    // Every public track is indexed (the doc carries `unlisted`, so browse/search
    // filter it while insights still enumerate it)...
    const ms = getMeilisearchClient();
    const task = await ms.index(index).addDocuments([buildMusicSearchDoc(event, kind)]);
    try {
      // ...and applied before the next version of this address looks for it.
      await ms.index(index).waitForTask(task.taskUid, { timeOutMs: 10_000 });
    } catch (err) {
      console.error(`[ingester] ${index} write still pending:`, (err as Error).message);
    }

    // Only LISTED versions feed the genre/tag chip counts, so the counts match
    // what /music/browse returns. Albums never carry catalog:none.
    const listed = kind === 33123 || isListedPublicMusic(event.tags);
    if (!listed || !(await redis.sadd("music:counted_events", event.id))) return;
    const genre = getTagValue(event, "genre");
    const hashtags = event.tags.filter((t) => t[0] === "t").map((t) => t[1]);
    const pipeline = redis.pipeline();
    if (genre) pipeline.zincrby("music:genre_counts", 1, genre);
    for (const tag of hashtags) pipeline.zincrby("music:tag_counts", 1, tag);
    if (genre || hashtags.length > 0) await pipeline.exec();
  });
}

/**
 * Flag fans whose saved version of this track/project is older than `event`
 * (WIR-165). Runs for public AND non-public events: a private project still
 * updates for the collaborators it is addressed to — but only for them, since
 * nobody else can fetch it. Never throws; a flagging failure must not stop
 * indexing.
 */
async function flagSavedVersions(event: NostrEvent) {
  try {
    const audience = isNonPublicEvent(event)
      ? event.tags.filter((t) => t[0] === "p" && t[1]).map((t) => t[1])
      : null;
    const flagged = await savedVersionService.flagUpdates(event, audience);
    await pushSavedVersionUpdates(event, flagged);
  } catch (err) {
    console.error("[ingester] Failed to flag saved versions:", (err as Error).message);
  }
}

/**
 * One `music_update` push per fan whose saved row was just flagged (WIR-171).
 * Only ever reached from the own relay (decideAction gates 31683/33123), and
 * only for rows flagUpdates actually moved — a backfill re-ingest flags
 * nobody, so it pushes to nobody. The author never gets one for their own
 * edit. Body carries the public title only; a non-public event reaches only
 * the fans it is addressed to (the audience flagUpdates was given).
 */
async function pushSavedVersionUpdates(event: NostrEvent, fans: string[]) {
  // A shared project (WIR-172) is signed by its project key and names its
  // human holders ["p", x, "", "owner"]; they edited it, so they are not
  // fans to notify. Excluding is safe even when the tag is spoofed: naming
  // someone `owner` only mutes pushes about THIS event for them.
  const owners = new Set(
    event.tags.filter((t) => t[0] === "p" && t[1] && t[3] === "owner").map((t) => t[1]),
  );
  const recipients = fans.filter((p) => p !== event.pubkey && !owners.has(p));
  if (recipients.length === 0) return;
  const address = savedVersionAddress(event);
  if (!address) return;
  const noun = event.kind === 33123 ? "project" : "track";
  const title = preview(getTagValue(event, "title") ?? "untitled", 80);
  let actorName: string | undefined;
  try {
    const [p] = await profileCacheService.getBatchProfiles([event.pubkey]);
    actorName = p?.displayName?.trim() || p?.name?.trim() || undefined;
  } catch {
    // no name → tags
  }
  // No kind 0 (a project key has none unless the project is public): the
  // artist credit, then the release title, never a hex stub.
  const artist = getTagValue(event, "artist")?.trim();
  for (const recipient of recipients) {
    await enqueueNotification({
      pubkey: recipient,
      type: "music_update",
      title: actorName ?? (artist ? preview(artist, 80) : title),
      body: `updated ${noun}: ${title}`,
      url: `soot://music/${noun === "track" ? "track" : "album"}/${address}`,
      collapseKey: `music_update:${recipient}`,
      data: { address, actor: event.pubkey, kind: event.kind, eventId: event.id },
    });
  }
}

async function indexMusicRelease(event: NostrEvent, kind: 31683 | 33123) {
  await flagSavedVersions(event);
  await syncMusicSearchDocs(event, kind);
  if (isNonPublicEvent(event)) return;

  const dTag = getTagValue(event, "d") ?? "";
  try {
    await revisionService.captureRevision(`${kind}:${event.pubkey}:${dTag}`, event);
  } catch (err) {
    const noun = kind === 31683 ? "track" : "album";
    console.error(`[ingester] Failed to capture ${noun} revision:`, (err as Error).message);
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
        await inAddressOrder(addr, async () => {
          const docs = await findAddressDocs(index, addr, addrPubkey);
          await dropMusicDocs(
            index,
            docs.filter((h) => (h.created_at as number) <= event.created_at),
          );
        });
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
