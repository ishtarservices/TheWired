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
  await profilesIndex.updateFilterableAttributes(["pubkey"]);

  // Tracks index (music)
  try {
    await ms.createIndex("tracks", { primaryKey: "id" });
  } catch {
    // Index already exists
  }
  const tracksIndex = ms.index("tracks");
  await tracksIndex.updateSearchableAttributes(["title", "artist", "genre"]);
  await tracksIndex.updateFilterableAttributes(["pubkey", "genre"]);
  await tracksIndex.updateSortableAttributes(["created_at"]);

  // Albums index (music)
  try {
    await ms.createIndex("albums", { primaryKey: "id" });
  } catch {
    // Index already exists
  }
  const albumsIndex = ms.index("albums");
  await albumsIndex.updateSearchableAttributes(["title", "artist", "genre"]);
  await albumsIndex.updateFilterableAttributes(["pubkey", "genre"]);
  await albumsIndex.updateSortableAttributes(["created_at"]);

  console.log("[meilisearch] Indexes initialized");
}
