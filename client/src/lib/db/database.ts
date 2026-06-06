import { openDB, type IDBPDatabase } from "idb";
import type { AIConversation, AIMessage } from "@/types/ai";

const DB_NAME = "thewired_v1";
const DB_VERSION = 2;

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
  subscriptions: {
    key: string;
    value: {
      sub_id: string;
      last_eose: Record<string, number>;
      filters: unknown[];
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
      },
    });
  }
  return dbPromise;
}
