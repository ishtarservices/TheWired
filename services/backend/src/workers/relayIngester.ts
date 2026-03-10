import { config } from "../config.js";
import { db } from "../db/connection.js";
import { cachedProfiles } from "../db/schema/profiles.js";
import { spaceMembers } from "../db/schema/members.js";
import { spaces } from "../db/schema/spaces.js";
import { spaceActivityDaily, memberEngagement } from "../db/schema/analytics.js";
import { getRedis } from "../lib/redis.js";
import { getMeilisearchClient } from "../lib/meilisearch.js";
import { verifyEvent } from "../lib/nostr/eventVerifier.js";
import { enqueueNotification } from "../services/notificationEnqueue.js";
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

      // Main subscription: all event kinds from last-seen forward
      ws.send(
        JSON.stringify([
          "REQ",
          "ingester",
          { kinds: [0, 1, 5, 7, 9, 22, 30023, 34236, 31683, 33123, 30119, 9735, 9021, 9022, 39000], since },
        ]),
      );

      // Backfill subscription: fetch ALL music events to cover gaps.
      // Meilisearch deduplicates by primary key (event id), so re-indexing is safe.
      // The counted_events Redis set prevents double-counting.
      ws.send(
        JSON.stringify([
          "REQ",
          "ingester-music-backfill",
          { kinds: [31683, 33123, 5] },
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
      case 5:
        await processDeletion(event);
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

    // Index searchable content kinds into Meilisearch (generic events index).
    // Exclude music kinds — they have dedicated tracks/albums indexes.
    if ([1, 9, 22, 30023, 34236, 30119].includes(event.kind)) {
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

    // Enqueue push notifications for mentioned users
    const mentionedPubkeys = event.tags
      .filter((t) => t[0] === "p" && t[1] !== event.pubkey)
      .map((t) => t[1]);

    // Strip nostr:npub/nevent/naddr/note references from push notification preview
    const cleanContent = event.content.replace(/nostr:(npub|nevent|naddr|note)1[a-z0-9]+/g, "@mention").replace(/\s{2,}/g, " ").trim();
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
    const imageUrl = getTagValue(event, "image") ?? getTagValue(event, "thumb") ?? "";
    const hashtags = event.tags.filter((t) => t[0] === "t").map((t) => t[1]);

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
        created_at: event.created_at,
      },
    ]);

    // Track genre and tag popularity — deduplicate so re-processing the same
    // event (relay reconnect, replay) doesn't inflate counts.
    const alreadyCounted = await redis.sismember("music:counted_events", event.id);
    if (!alreadyCounted) {
      await redis.sadd("music:counted_events", event.id);
      const pipeline = redis.pipeline();
      if (genre) {
        pipeline.zincrby("music:genre_counts", 1, genre);
      }
      for (const tag of hashtags) {
        pipeline.zincrby("music:tag_counts", 1, tag);
      }
      if (genre || hashtags.length > 0) {
        await pipeline.exec();
      }
    }
  }

  async function indexMusicAlbum(event: NostrEvent) {
    // Skip unlisted albums from search indexing
    if (getTagValue(event, "visibility") === "unlisted") return;

    const ms = getMeilisearchClient();
    const title = getTagValue(event, "title");
    const artist = getTagValue(event, "artist");
    const genre = getTagValue(event, "genre");
    const dTag = getTagValue(event, "d") ?? "";
    const imageUrl = getTagValue(event, "image") ?? getTagValue(event, "thumb") ?? "";
    const hashtags = event.tags.filter((t) => t[0] === "t").map((t) => t[1]);

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
        created_at: event.created_at,
      },
    ]);

    // Track genre and tag popularity — deduplicated
    const alreadyCounted = await redis.sismember("music:counted_events", event.id);
    if (!alreadyCounted) {
      await redis.sadd("music:counted_events", event.id);
      const pipeline = redis.pipeline();
      if (genre) {
        pipeline.zincrby("music:genre_counts", 1, genre);
      }
      for (const tag of hashtags) {
        pipeline.zincrby("music:tag_counts", 1, tag);
      }
      if (genre || hashtags.length > 0) {
        await pipeline.exec();
      }
    }
  }

  async function processDeletion(event: NostrEvent) {
    const ms = getMeilisearchClient();
    for (const tag of event.tags) {
      if (tag[0] !== "a" || !tag[1]) continue;
      const addr = tag[1];
      const [kindStr, addrPubkey, ...dParts] = addr.split(":");
      const dTag = dParts.join(":");
      // Only honor deletions from the content author
      if (addrPubkey !== event.pubkey) continue;
      const kind = parseInt(kindStr, 10);

      if (kind === 31683) {
        // Delete track from relay DB — only events created before the deletion.
        // Re-published events with the same d-tag but newer created_at supersede the deletion.
        try {
          await db.execute(
            sql`DELETE FROM relay.events
                WHERE kind = 31683
                  AND pubkey = ${addrPubkey}
                  AND tags @> ${JSON.stringify([["d", dTag]])}::jsonb
                  AND created_at <= ${event.created_at}`,
          );
        } catch (err) {
          console.error("[ingester] Failed to delete track from relay DB:", err);
        }
        // Delete from Meilisearch tracks index — only docs created before the deletion
        try {
          const results = await ms.index("tracks").search("", {
            filter: `pubkey = "${addrPubkey}"`,
            limit: 100,
          });
          const matchingHits = results.hits.filter(
            (h: Record<string, unknown>) =>
              h.addressable_id === addr &&
              (h.created_at as number) <= event.created_at,
          );
          const docIds = matchingHits.map((h: Record<string, unknown>) => h.id as string);
          if (docIds.length > 0) {
            await ms.index("tracks").deleteDocuments(docIds);
            // Decrement genre/tag counts and remove from counted set
            for (const h of matchingHits) {
              const hGenre = h.genre as string;
              const hTags = (h.hashtags as string[]) ?? [];
              if (hGenre) await redis.zincrby("music:genre_counts", -1, hGenre);
              for (const t of hTags) await redis.zincrby("music:tag_counts", -1, t);
              await redis.srem("music:counted_events", h.id as string);
            }
            // Clean up zero/negative entries
            await redis.zremrangebyscore("music:genre_counts", "-inf", "0");
            await redis.zremrangebyscore("music:tag_counts", "-inf", "0");
          }
        } catch (err) {
          console.error("[ingester] Failed to delete track from Meilisearch:", err);
        }
      } else if (kind === 33123) {
        // Delete album from relay DB — only events created before the deletion.
        try {
          await db.execute(
            sql`DELETE FROM relay.events
                WHERE kind = 33123
                  AND pubkey = ${addrPubkey}
                  AND tags @> ${JSON.stringify([["d", dTag]])}::jsonb
                  AND created_at <= ${event.created_at}`,
          );
        } catch (err) {
          console.error("[ingester] Failed to delete album from relay DB:", err);
        }
        // Delete from Meilisearch albums index — only docs created before the deletion
        try {
          const results = await ms.index("albums").search("", {
            filter: `pubkey = "${addrPubkey}"`,
            limit: 100,
          });
          const matchingHits = results.hits.filter(
            (h: Record<string, unknown>) =>
              h.addressable_id === addr &&
              (h.created_at as number) <= event.created_at,
          );
          const docIds = matchingHits.map((h: Record<string, unknown>) => h.id as string);
          if (docIds.length > 0) {
            await ms.index("albums").deleteDocuments(docIds);
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
          console.error("[ingester] Failed to delete album from Meilisearch:", err);
        }
      }

      // Also remove from general events Meilisearch index
      for (const eTag of event.tags) {
        if (eTag[0] === "e" && eTag[1]) {
          try {
            await ms.index("events").deleteDocument(eTag[1]);
          } catch {
            // doc may not exist
          }
        }
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

  connect();
}
