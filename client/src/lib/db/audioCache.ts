import { openDB, type IDBPDatabase } from "idb";

const DB_NAME = "thewired_audio_cache";
const DB_VERSION = 1;
const STORE_NAME = "audio_cache";

interface AudioCacheEntry {
  addressableId: string;
  blob: Blob;
  mimeType: string;
  size: number;
  cachedAt: number;
}

interface AudioCacheDB {
  audio_cache: {
    key: string;
    value: AudioCacheEntry;
  };
}

let dbPromise: Promise<IDBPDatabase<AudioCacheDB>> | null = null;

function getAudioCacheDB(): Promise<IDBPDatabase<AudioCacheDB>> {
  if (!dbPromise) {
    dbPromise = openDB<AudioCacheDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "addressableId" });
        }
      },
    }).catch((err) => {
      // Reset so next call retries instead of returning a rejected promise forever
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

export async function cacheAudio(
  addressableId: string,
  blob: Blob,
  mimeType: string,
): Promise<void> {
  const db = await getAudioCacheDB();
  await db.put(STORE_NAME, {
    addressableId,
    blob,
    mimeType,
    size: blob.size,
    cachedAt: Date.now(),
  });
}

export async function getCachedAudio(
  addressableId: string,
): Promise<{ blob: Blob; mimeType: string } | null> {
  const db = await getAudioCacheDB();
  const entry = await db.get(STORE_NAME, addressableId);
  if (!entry) return null;
  return { blob: entry.blob, mimeType: entry.mimeType };
}

export async function removeCachedAudio(addressableId: string): Promise<void> {
  const db = await getAudioCacheDB();
  await db.delete(STORE_NAME, addressableId);
}

export async function getCacheSize(): Promise<number> {
  const db = await getAudioCacheDB();
  const all = await db.getAll(STORE_NAME);
  return all.reduce((sum, entry) => sum + entry.size, 0);
}

export async function getAllCachedIds(): Promise<string[]> {
  const db = await getAudioCacheDB();
  return db.getAllKeys(STORE_NAME) as Promise<string[]>;
}
