import { openDB, type IDBPDatabase } from "idb";
import type { AIConversation, AIMessage, PendingWrite } from "@/types/ai";
import type { ArticleDraftRecord } from "@/types/media";

const DB_NAME = "thewired_v1";
const DB_VERSION = 5;

export interface TheWiredDB {
  events: {
    key: string;
    value: {
      id: string;
      pubkey: string;
      created_at: number;
      kind: number;
      tags: string[][];
      content: string;
      sig: string;
      _cachedAt: number;
      _groupId?: string;
    };
    indexes: {
      by_kind: number;
      by_pubkey: string;
      by_created: number;
      by_kind_time: [number, number];
      by_group: string;
      by_cached_at: number;
    };
  };
  profiles: {
    key: string;
    value: {
      pubkey: string;
      name?: string;
      display_name?: string;
      about?: string;
      picture?: string;
      banner?: string;
      nip05?: string;
      lud16?: string;
      lud06?: string;
      website?: string;
      created_at?: number;
      _cachedAt: number;
    };
    indexes: {
      by_name: string;
      by_cached_at: number;
    };
  };
  /** Persistent publish outbox (audit #34): signed events awaiting a relay OK so
   *  a relay drop / refresh can't lose a publish. First OK deletes the row;
   *  un-acked rows are replayed on reconnect + next launch (<24h). */
  outbox: {
    key: string;
    value: {
      id: string;
      event: {
        id: string;
        pubkey: string;
        created_at: number;
        kind: number;
        tags: string[][];
        content: string;
        sig: string;
      };
      targetRelays?: string[];
      queuedAt: number;
    };
    indexes: {
      by_queued: number;
    };
  };
  user_state: {
    key: string;
    value: {
      key: string;
      data: unknown;
      _cachedAt: number;
    };
  };
  aiConversations: {
    key: string;
    value: AIConversation & { _account: string; _cachedAt: number };
    indexes: {
      by_account: string;
      by_account_updated: [string, number];
    };
  };
  aiMessages: {
    key: string;
    value: AIMessage & { _account: string; _cachedAt: number };
    indexes: {
      by_conversation: string;
      by_account: string;
    };
  };
  aiPendingWrites: {
    key: string;
    value: PendingWrite & { _account: string; _cachedAt: number };
    indexes: {
      by_account: string;
      by_conversation: string;
    };
  };
  /** Device-local, multi-draft article authoring (per-account via `_account`).
   *  Local-only — never synced to a relay; see `articleDraftStore.ts`. */
  articleDrafts: {
    key: string;
    value: ArticleDraftRecord & { _account: string; _cachedAt: number };
    indexes: {
      by_account: string;
      by_account_updated: [string, number];
    };
  };
}

let dbPromise: Promise<IDBPDatabase<TheWiredDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<TheWiredDB>> {
  if (!dbPromise) {
    dbPromise = openDB<TheWiredDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          // Events store
          const eventStore = db.createObjectStore("events", { keyPath: "id" });
          eventStore.createIndex("by_kind", "kind");
          eventStore.createIndex("by_pubkey", "pubkey");
          eventStore.createIndex("by_created", "created_at");
          eventStore.createIndex("by_kind_time", ["kind", "created_at"]);
          eventStore.createIndex("by_group", "_groupId");
          eventStore.createIndex("by_cached_at", "_cachedAt");

          // Profiles store
          const profileStore = db.createObjectStore("profiles", {
            keyPath: "pubkey",
          });
          profileStore.createIndex("by_name", "name");
          profileStore.createIndex("by_cached_at", "_cachedAt");

          // Subscriptions store
          db.createObjectStore("subscriptions", { keyPath: "sub_id" });

          // User state store
          db.createObjectStore("user_state", { keyPath: "key" });
        }

        if (oldVersion < 2) {
          // AI conversations + messages (per-account, isolated via _account index)
          const conversationStore = db.createObjectStore("aiConversations", {
            keyPath: "id",
          });
          conversationStore.createIndex("by_account", "_account");
          conversationStore.createIndex("by_account_updated", [
            "_account",
            "updatedAt",
          ]);

          const messageStore = db.createObjectStore("aiMessages", {
            keyPath: "id",
          });
          messageStore.createIndex("by_conversation", "conversationId");
          messageStore.createIndex("by_account", "_account");
        }

        if (oldVersion < 3) {
          // AI pending writes — model-proposed drafts awaiting human approval
          // survive a reload instead of silently vanishing (audit #98).
          const pendingWriteStore = db.createObjectStore("aiPendingWrites", {
            keyPath: "id",
          });
          pendingWriteStore.createIndex("by_account", "_account");
          pendingWriteStore.createIndex("by_conversation", "conversationId");
        }

        if (oldVersion < 4) {
          // Persistent publish outbox (audit #34).
          const outboxStore = db.createObjectStore("outbox", { keyPath: "id" });
          outboxStore.createIndex("by_queued", "queuedAt");

          // Drop the dead `subscriptions` store — it was never written to; the
          // in-memory reconnect-`since` path superseded it (audit #83).
          if (db.objectStoreNames.contains("subscriptions")) {
            db.deleteObjectStore("subscriptions");
          }
        }

        if (oldVersion < 5) {
          // Device-local multi-draft article authoring. Per-account isolation
          // via `_account`; `by_account_updated` powers the most-recent-first
          // drafts list without an in-memory sort over the whole store.
          const draftStore = db.createObjectStore("articleDrafts", {
            keyPath: "id",
          });
          draftStore.createIndex("by_account", "_account");
          draftStore.createIndex("by_account_updated", ["_account", "updatedAt"]);
        }
      },
      // #84 — survive the multi-tab / unexpected-close cases instead of caching a
      // wedged connection. `terminated` (and a rejected open) reset the cached
      // promise so the next getDB() reopens cleanly.
      blocked() {
        console.warn("[db] open blocked — another tab holds an older DB version open");
      },
      blocking() {
        // A newer version wants to open in another context; close ours so it can.
        void dbPromise?.then((db) => db.close()).catch(() => {});
        dbPromise = null;
      },
      terminated() {
        console.error("[db] connection terminated unexpectedly — will reopen on next use");
        dbPromise = null;
      },
    }).catch((err) => {
      // Don't cache a rejected promise — let the next call retry (#84).
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}
