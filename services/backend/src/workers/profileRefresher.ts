import { db } from "../db/connection.js";
import { cachedProfiles } from "../db/schema/profiles.js";
import { getMeilisearchClient } from "../lib/meilisearch.js";
import { profileCacheService } from "../services/profileCacheService.js";
import { config } from "../config.js";
import { lte } from "drizzle-orm";

/** Refresh stale cached profiles periodically */
export function startProfileRefresher(): { stop: () => void } {
  async function refresh() {
    console.log("[profiles] Refreshing stale profiles...");

    const staleThreshold = Date.now() - 24 * 60 * 60 * 1000; // 24h ago

    // Find stale profiles
    const stale = await db
      .select({ pubkey: cachedProfiles.pubkey })
      .from(cachedProfiles)
      .where(lte(cachedProfiles.fetchedAt, staleThreshold))
      .limit(50);

    if (stale.length === 0) {
      console.log("[profiles] No stale profiles found");
      return;
    }

    console.log(`[profiles] Found ${stale.length} stale profiles to refresh`);

    const pubkeys = stale.map((p) => p.pubkey);

    // Subscribe to relay for kind:0 from each stale pubkey
    const ws = new WebSocket(config.relayUrl);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close();
        resolve();
      }, 30_000);

      let receivedEose = false;

      ws.addEventListener("open", () => {
        ws.send(
          JSON.stringify(["REQ", "profile-refresh", { kinds: [0], authors: pubkeys, limit: pubkeys.length }]),
        );
      });

      ws.addEventListener("message", async (event) => {
        try {
          const msg = JSON.parse(String(event.data));
          if (msg[0] === "EVENT" && msg[2]) {
            const nostrEvent = msg[2] as {
              pubkey: string;
              content: string;
              created_at: number;
            };
            await upsertProfile(nostrEvent);
          } else if (msg[0] === "EOSE") {
            receivedEose = true;
            ws.send(JSON.stringify(["CLOSE", "profile-refresh"]));
            clearTimeout(timeout);
            ws.close();
            resolve();
          }
        } catch {
          // ignore parse errors
        }
      });

      ws.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error("WebSocket error"));
      });

      ws.addEventListener("close", () => {
        clearTimeout(timeout);
        if (!receivedEose) resolve();
      });
    }).catch((err) => {
      console.error("[profiles] Refresh error:", err.message);
    });
  }

  async function upsertProfile(event: { pubkey: string; content: string; created_at: number }) {
    // Version-guarded upsert: never regress to an older kind:0.
    const result = await profileCacheService.upsert({
      pubkey: event.pubkey,
      createdAt: event.created_at,
      content: event.content,
    });
    if (!result || !result.applied) return; // bad JSON, or stale (older) event

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

  // Run every hour
  const interval = setInterval(refresh, 60 * 60 * 1000);
  // Delay first run by 30s to let relay connection establish
  const initialTimeout = setTimeout(refresh, 30_000);

  return {
    stop: () => {
      clearInterval(interval);
      clearTimeout(initialTimeout);
      console.log("[profiles] Stopped");
    },
  };
}
