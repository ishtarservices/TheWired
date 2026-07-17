// ─── SQLite StorageAdapter (expo-sqlite) ─────────────────────────────
// Mobile counterpart of the desktop IndexedDB layer: the logical stores
// become kv_<store> tables. Two databases:
//   • thewired_app        — app-global / pre-login (guest cache, app prefs)
//   • thewired_<pubkey>   — per-account isolation, same convention as the
//                           desktop's per-account IndexedDB databases
// getStore() resolves the account DB when one is open, else the app DB —
// resolution happens per call, so store handles obtained before login write
// to the account DB after login.
//
// expo-sqlite is the Expo Go-compatible choice; op-sqlite is a dev-client-
// only upgrade for later (guide 05) — swap happens inside this file only.

import * as SQLite from "expo-sqlite";

import type { KVStore, StorageAdapter, StoreName } from "@/core/adapters";

const STORE_NAMES: StoreName[] = [
  "events",
  "profiles",
  "outbox",
  "user_state",
  "aiConversations",
  "aiMessages",
  "aiPendingWrites",
  "articleDrafts",
  "dm_messages",
  "dm_state",
  "space_chat",
  "threads",
];

/** The slice of expo-sqlite's SQLiteDatabase this adapter uses — injectable
 *  so tests can run against an in-memory fake. */
export interface SqlDatabase {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: string[]): Promise<unknown>;
  getFirstAsync<T>(sql: string, ...params: string[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: string[]): Promise<T[]>;
  closeAsync(): Promise<void>;
}

export type OpenDatabase = (name: string) => Promise<SqlDatabase>;

/** StorageAdapter plus an app-global escape hatch: stores that must ignore
 *  the per-account DB (theme preset, pre-login prefs) read/write the app DB
 *  regardless of which account is open. Mobile-local extension — the core
 *  interface stays platform-neutral. */
export interface MobileStorage extends StorageAdapter {
  getAppStore<T>(name: StoreName): KVStore<T>;
}

const APP_DB = "thewired_app";

function tableFor(store: StoreName): string {
  return `kv_${store}`;
}

async function initDb(db: SqlDatabase): Promise<void> {
  await db.execAsync("PRAGMA journal_mode = WAL;");
  for (const store of STORE_NAMES) {
    await db.execAsync(
      `CREATE TABLE IF NOT EXISTS ${tableFor(store)} (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);`,
    );
  }
}

class SqliteKVStore<T> implements KVStore<T> {
  constructor(
    private readonly db: () => Promise<SqlDatabase>,
    private readonly table: string,
  ) {}

  async get(key: string): Promise<T | undefined> {
    const row = await (await this.db()).getFirstAsync<{ value: string }>(
      `SELECT value FROM ${this.table} WHERE key = ?`,
      key,
    );
    return row ? (JSON.parse(row.value) as T) : undefined;
  }

  async put(key: string, value: T): Promise<void> {
    await (await this.db()).runAsync(
      `INSERT OR REPLACE INTO ${this.table} (key, value) VALUES (?, ?)`,
      key,
      JSON.stringify(value),
    );
  }

  async delete(key: string): Promise<void> {
    await (await this.db()).runAsync(`DELETE FROM ${this.table} WHERE key = ?`, key);
  }

  async getAll(): Promise<T[]> {
    const rows = await (await this.db()).getAllAsync<{ value: string }>(
      `SELECT value FROM ${this.table}`,
    );
    return rows.map((row) => JSON.parse(row.value) as T);
  }

  async getAllKeys(): Promise<string[]> {
    const rows = await (await this.db()).getAllAsync<{ key: string }>(
      `SELECT key FROM ${this.table}`,
    );
    return rows.map((row) => row.key);
  }

  async clear(): Promise<void> {
    await (await this.db()).runAsync(`DELETE FROM ${this.table}`);
  }
}

const defaultOpen: OpenDatabase = async (name) =>
  SQLite.openDatabaseAsync(name) as Promise<SqlDatabase>;

export function createSqliteStorage(open: OpenDatabase = defaultOpen): MobileStorage {
  let appDb: Promise<SqlDatabase> | null = null;
  let accountDb: Promise<SqlDatabase> | null = null;
  let accountPubkey: string | null = null;

  const openInited = async (name: string): Promise<SqlDatabase> => {
    const db = await open(name);
    await initDb(db);
    return db;
  };

  const appDbRef = (): Promise<SqlDatabase> => {
    if (!appDb) appDb = openInited(APP_DB);
    return appDb;
  };

  const currentDb = (): Promise<SqlDatabase> => {
    if (accountDb) return accountDb;
    return appDbRef();
  };

  return {
    getStore<T>(name: StoreName): KVStore<T> {
      return new SqliteKVStore<T>(currentDb, tableFor(name));
    },

    getAppStore<T>(name: StoreName): KVStore<T> {
      return new SqliteKVStore<T>(appDbRef, tableFor(name));
    },

    async openForAccount(pubkey: string): Promise<void> {
      // Same account → keep the open handle.
      if (accountPubkey === pubkey && accountDb) return;
      const previous = accountDb;
      // Per-account DB name mirrors desktop's `thewired_<pubkey>`; hex
      // pubkeys are filename-safe, but sanitize defensively.
      const safe = pubkey.replace(/[^0-9a-f]/gi, "").toLowerCase();
      accountPubkey = pubkey;
      accountDb = openInited(`thewired_${safe}`);
      await accountDb;
      if (previous) {
        previous.then((db) => db.closeAsync()).catch(() => {});
      }
    },

    async close(): Promise<void> {
      const dbs = [appDb, accountDb];
      appDb = null;
      accountDb = null;
      accountPubkey = null;
      for (const dbPromise of dbs) {
        if (!dbPromise) continue;
        try {
          await (await dbPromise).closeAsync();
        } catch {
          // already closed / failed to open — nothing to release
        }
      }
    },
  };
}
