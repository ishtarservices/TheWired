import { config } from "../config.js";
import { db } from "../db/connection.js";
import { cachedProfiles } from "../db/schema/profiles.js";
import { spaceMembers } from "../db/schema/members.js";
import { spaces } from "../db/schema/spaces.js";
import { spaceActivityDaily, memberEngagement } from "../db/schema/analytics.js";
import { getRedis } from "../lib/redis.js";
import { getMeilisearchClient } from "../lib/meilisearch.js";
import { verifyEvent } from "../lib/nostr/eventVerifier.js";
import { eq, and, sql } from "drizzle-orm";

interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

function getTagValue(event: NostrEvent, name: string): string | undefined {
  const tag = event.tags.find((t) => t[0] === name);
  return tag?.[1];
}

function today(): string {
  return new Date().toISOString().split("T")[0];
}

/** Connects to the relay and indexes events into backend stores */
export function startRelayIngester() {
  const redis = getRedis();
  const SINCE_KEY = "ingester:last_seen";

  async function getLastSeen(): Promise<number> {
    const val = await redis.get(SINCE_KEY);
    return val ? parseInt(val, 10) : Math.floor(Date.now() / 1000) - 3600;
  }

  async function setLastSeen(ts: number): Promise<void> {
    await redis.set(SINCE_KEY, String(ts));
  }

  function connect() {
    const ws = new WebSocket(config.relayUrl);

    ws.addEventListener("open", async () => {
      console.log("[ingester] Connected to relay");
      const since = await getLastSeen();
      ws.send(
        JSON.stringify([
          "REQ",
          "ingester",
          { kinds: [0, 1, 7, 9, 22, 30023, 34236, 31683, 33123, 30119, 9735, 9021, 9022, 39000], since },
        ]),
      );
    });

    ws.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(String(event.data));
        if (msg[0] === "EVENT" && msg[2]) {
          processEvent(msg[2] as NostrEvent).catch((err) => {
            console.error("[ingester] Error processing event:", err.message);
          });
        }
      } catch {
        // ignore parse errors
      }
    });

    ws.addEventListener("close", () => {
      console.log("[ingester] Disconnected, reconnecting in 5s...");
      setTimeout(connect, 5000);
    });

    ws.addEventListener("error", () => {
      console.error("[ingester] WebSocket error");
    });
  }

  async function processEvent(event: NostrEvent) {
    if (!verifyEvent(event)) return;

    // Update last-seen timestamp
    await setLastSeen(Math.max(event.created_at, await getLastSeen()));

    switch (event.kind) {
      case 0:
        await indexProfile(event);
        break;
      case 7:
        await indexReaction(event);
        break;
      case 9:
        await indexChatMessage(event);
        break;
      case 9735:
        await indexZapReceipt(event);
        break;
      case 9021:
        await indexJoin(event);
        break;
      case 9022:
        await indexLeave(event);
        break;
      case 39000:
        await indexGroupMetadata(event);
        break;
      case 31683:
        await indexMusicTrack(event);
        break;
      case 33123:
        await indexMusicAlbum(event);
        break;
      default:
        break;
    }

    // Index searchable content kinds into Meilisearch
    if ([1, 9, 22, 30023, 34236, 31683, 33123, 30119].includes(event.kind)) {
      await indexToMeilisearch(event);
    }
  }

  async function indexProfile(event: NostrEvent) {
    try {
      const profile = JSON.parse(event.content);
      const data = {
        pubkey: event.pubkey,
        name: profile.name ?? null,
        displayName: profile.display_name ?? null,
        picture: profile.picture ?? null,
        about: profile.about ?? null,
        nip05: profile.nip05 ?? null,
        fetchedAt: Date.now(),
      };

      await db
        .insert(cachedProfiles)
        .values(data)
        .onConflictDoUpdate({
          target: cachedProfiles.pubkey,
          set: {
            name: data.name,
            displayName: data.displayName,
            picture: data.picture,
            about: data.about,
            nip05: data.nip05,
            fetchedAt: data.fetchedAt,
          },
        });

      // Push to Meilisearch profiles index
      const ms = getMeilisearchClient();
      await ms.index("profiles").addDocuments([
        {
          pubkey: event.pubkey,
          name: profile.name,
          display_name: profile.display_name,
          about: profile.about,
          nip05: profile.nip05,
          picture: profile.picture,
        },
      ]);
    } catch {
      // invalid profile JSON
    }
  }

  async function indexChatMessage(event: NostrEvent) {
    const spaceId = getTagValue(event, "h");
    if (!spaceId) return;

    const date = today();

    // Increment space activity
    await db
      .insert(spaceActivityDaily)
      .values({ spaceId, date, messageCount: 1, uniqueAuthors: 1, newMembers: 0, leftMembers: 0 })
      .onConflictDoUpdate({
        target: [spaceActivityDaily.spaceId, spaceActivityDaily.date],
        set: { messageCount: sql`${spaceActivityDaily.messageCount} + 1` },
      });

    // Increment member engagement
    await db
      .insert(memberEngagement)
      .values({ spaceId, pubkey: event.pubkey, date, messageCount: 1, reactionsGiven: 0, reactionsReceived: 0 })
      .onConflictDoUpdate({
        target: [memberEngagement.spaceId, memberEngagement.pubkey, memberEngagement.date],
        set: { messageCount: sql`${memberEngagement.messageCount} + 1` },
      });
  }

  async function indexReaction(event: NostrEvent) {
    const targetEventId = getTagValue(event, "e");
    if (!targetEventId) return;

    const spaceId = getTagValue(event, "h");
    if (!spaceId) return;

    const date = today();
    const targetPubkey = getTagValue(event, "p");

    // Increment reactions_given for reactor
    await db
      .insert(memberEngagement)
      .values({ spaceId, pubkey: event.pubkey, date, messageCount: 0, reactionsGiven: 1, reactionsReceived: 0 })
      .onConflictDoUpdate({
        target: [memberEngagement.spaceId, memberEngagement.pubkey, memberEngagement.date],
        set: { reactionsGiven: sql`${memberEngagement.reactionsGiven} + 1` },
      });

    // Increment reactions_received for target
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

    // Extract sats from bolt11 in description tag
    let sats = 0;
    const bolt11Tag = event.tags.find((t) => t[0] === "bolt11");
    if (bolt11Tag?.[1]) {
      // Simple extraction: look for amount in description
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

    await db
      .insert(spaceMembers)
      .values({ spaceId, pubkey: event.pubkey })
      .onConflictDoNothing();
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

    try {
      const meta = JSON.parse(event.content);
      await db
        .update(spaces)
        .set({
          name: meta.name ?? groupId,
          picture: meta.picture ?? null,
          about: meta.about ?? null,
        })
        .where(eq(spaces.id, groupId));
    } catch {
      // invalid metadata JSON
    }
  }

  async function indexMusicTrack(event: NostrEvent) {
    // Skip unlisted tracks from search indexing
    if (getTagValue(event, "visibility") === "unlisted") return;

    const ms = getMeilisearchClient();
    const title = getTagValue(event, "title");
    const artist = getTagValue(event, "artist");
    const genre = getTagValue(event, "genre");
    const dTag = getTagValue(event, "d") ?? "";

    await ms.index("tracks").addDocuments([
      {
        id: event.id,
        addressable_id: `31683:${event.pubkey}:${dTag}`,
        title: title ?? "",
        artist: artist ?? "",
        genre: genre ?? "",
        pubkey: event.pubkey,
        created_at: event.created_at,
      },
    ]);
  }

  async function indexMusicAlbum(event: NostrEvent) {
    // Skip unlisted albums from search indexing
    if (getTagValue(event, "visibility") === "unlisted") return;

    const ms = getMeilisearchClient();
    const title = getTagValue(event, "title");
    const artist = getTagValue(event, "artist");
    const genre = getTagValue(event, "genre");
    const dTag = getTagValue(event, "d") ?? "";

    await ms.index("albums").addDocuments([
      {
        id: event.id,
        addressable_id: `33123:${event.pubkey}:${dTag}`,
        title: title ?? "",
        artist: artist ?? "",
        genre: genre ?? "",
        pubkey: event.pubkey,
        created_at: event.created_at,
      },
    ]);
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

  connect();
}
