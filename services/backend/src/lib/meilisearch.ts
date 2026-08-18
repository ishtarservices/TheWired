import { MeiliSearch } from "meilisearch";
import { config } from "../config.js";

let client: MeiliSearch | null = null;

export function getMeilisearchClient(): MeiliSearch {
  if (!client) {
    client = new MeiliSearch({
      host: config.meilisearchUrl,
      apiKey: config.meilisearchKey,
    });
  }
  return client;
}

export async function initIndexes(): Promise<void> {
  const ms = getMeilisearchClient();

  // Events index
  try {
    await ms.createIndex("events", { primaryKey: "id" });
  } catch {
    // Index already exists
  }
  const eventsIndex = ms.index("events");
  await eventsIndex.updateSearchableAttributes(["content"]);
  await eventsIndex.updateFilterableAttributes(["kind", "pubkey"]);
  await eventsIndex.updateSortableAttributes(["created_at"]);

  // Profiles index
  try {
    await ms.createIndex("profiles", { primaryKey: "pubkey" });
  } catch {
    // Index already exists
  }
  const profilesIndex = ms.index("profiles");
  await profilesIndex.updateSearchableAttributes(["name", "display_name", "nip05", "about"]);
  // `has_nip05` is filterable so a browse list can require a verified handle;
  // `note_count` is sortable so "people worth following" has an ordering at all
  // (it is maintained by workers/profileStatsComputer.ts, not by kind:0 ingest).
  await profilesIndex.updateFilterableAttributes(["pubkey", "has_nip05"]);
  await profilesIndex.updateSortableAttributes(["note_count"]);

  // Tracks index (music)
  try {
    await ms.createIndex("tracks", { primaryKey: "id" });
  } catch {
    // Index already exists
  }
  const tracksIndex = ms.index("tracks");
  await tracksIndex.updateSearchableAttributes(["title", "artist", "genre", "hashtags"]);
  await tracksIndex.updateFilterableAttributes(["pubkey", "genre", "hashtags", "addressable_id"]);
  await tracksIndex.updateSortableAttributes(["created_at"]);

  // Albums index (music)
  try {
    await ms.createIndex("albums", { primaryKey: "id" });
  } catch {
    // Index already exists
  }
  const albumsIndex = ms.index("albums");
  await albumsIndex.updateSearchableAttributes(["title", "artist", "genre", "hashtags"]);
  await albumsIndex.updateFilterableAttributes(["pubkey", "genre", "hashtags", "addressable_id"]);
  await albumsIndex.updateSortableAttributes(["created_at"]);

  console.log("[meilisearch] Indexes initialized");
}
