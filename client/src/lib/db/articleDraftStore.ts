import { nanoid } from "nanoid";
import { getDB, type TheWiredDB } from "./database";
import type {
  ArticleDraftFields,
  ArticleDraftRecord,
} from "@/types/media";

/**
 * Per-account persistence for device-local article drafts. Mirrors
 * `aiConversationStore.ts` (index reads, `_account` isolation). Drafts are user
 * content, NOT cache — they are never TTL-expired; the only bound is a per-account
 * LRU cap so an abandoned-draft pile can't grow without limit (see eviction.ts
 * for the analogous cache policy).
 */

type StoredDraft = TheWiredDB["articleDrafts"]["value"];

/** Keep at most this many drafts per account; oldest-by-updatedAt are evicted. */
export const MAX_DRAFTS_PER_ACCOUNT = 50;

/** Legacy single-slot key written by the old localStorage-backed draft. */
const LEGACY_PREFIX = "wired:article-draft:";
function legacyKey(pubkey: string): string {
  return `${LEGACY_PREFIX}${pubkey}:new`;
}

function strip(stored: StoredDraft): ArticleDraftRecord {
  const { _account, _cachedAt, ...record } = stored;
  void _account;
  void _cachedAt;
  return record;
}

/**
 * Upsert the active editor session into its draft record. Preserves `createdAt`
 * across saves (read-modify-write) and stamps a fresh `updatedAt`. Enforces the
 * per-account cap after writing. Returns the saved record.
 */
export async function upsertDraft(
  account: string,
  id: string,
  fields: ArticleDraftFields,
  now: number = Date.now(),
): Promise<ArticleDraftRecord> {
  const db = await getDB();
  const existing = await db.get("articleDrafts", id);
  const record: StoredDraft = {
    ...fields,
    id,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    _account: account,
    _cachedAt: now,
  };
  await db.put("articleDrafts", record);
  await evictOverflow(account);
  return strip(record);
}

/** Read a single draft by id (no account check — ids are unguessable nanoids). */
export async function getDraft(
  id: string,
): Promise<ArticleDraftRecord | undefined> {
  const db = await getDB();
  const stored = await db.get("articleDrafts", id);
  return stored ? strip(stored) : undefined;
}

/** All drafts for an account, most-recently-edited first. */
export async function getDraftsForAccount(
  account: string,
): Promise<ArticleDraftRecord[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex("articleDrafts", "by_account", account);
  return all.map(strip).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteDraft(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("articleDrafts", id);
}

/** Update only the title (used by the Drafts list rename), bumping updatedAt. */
export async function renameDraft(
  id: string,
  title: string,
  now: number = Date.now(),
): Promise<void> {
  const db = await getDB();
  const existing = await db.get("articleDrafts", id);
  if (!existing) return;
  await db.put("articleDrafts", { ...existing, title, updatedAt: now, _cachedAt: now });
}

/** Drop oldest-by-updatedAt drafts once an account exceeds the cap. */
async function evictOverflow(account: string): Promise<void> {
  const db = await getDB();
  // [account] < [account, <any number>] < [account, []] in IndexedDB key order,
  // so this bound captures exactly this account's rows (avoids ±Infinity keys).
  const keys = await db.getAllKeysFromIndex(
    "articleDrafts",
    "by_account_updated",
    IDBKeyRange.bound([account], [account, []]),
  );
  // by_account_updated is ascending → oldest first; drop everything past the cap.
  const overflow = keys.length - MAX_DRAFTS_PER_ACCOUNT;
  if (overflow <= 0) return;
  const tx = db.transaction("articleDrafts", "readwrite");
  for (const key of keys.slice(0, overflow)) {
    tx.store.delete(key);
  }
  await tx.done;
}

// Migration is fire-and-forgotten from multiple surfaces; guard so concurrent
// callers don't each create a record before the localStorage key is cleared.
const migrated = new Set<string>();

/**
 * One-time import of the old single-slot localStorage draft
 * (`wired:article-draft:<pubkey>:new`) into the store, then delete the key.
 * Idempotent: no key (or already-imported) → no-op. Returns the new record's id
 * when something was imported, else null.
 */
export async function migrateLegacyArticleDraft(
  pubkey: string,
): Promise<string | null> {
  if (!pubkey || migrated.has(pubkey)) return null;
  migrated.add(pubkey);

  let raw: string | null = null;
  try {
    raw = localStorage.getItem(legacyKey(pubkey));
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: Record<string, unknown> | null = null;
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === "object") parsed = v as Record<string, unknown>;
  } catch {
    parsed = null;
  }
  // Remove the legacy key regardless — a corrupt/empty slot shouldn't linger.
  try {
    localStorage.removeItem(legacyKey(pubkey));
  } catch {
    /* ignore */
  }
  if (!parsed) return null;

  const title = String(parsed.title ?? "");
  const content = String(parsed.content ?? "");
  // Only worth keeping if it held real work.
  if (!title.trim() && !content.trim()) return null;

  const savedAt = Number(parsed.savedAt ?? 0) || 0;
  const at = savedAt > 0 ? savedAt * 1000 : Date.now();
  const id = nanoid();
  await upsertDraft(
    pubkey,
    id,
    {
      title,
      summary: String(parsed.summary ?? ""),
      image: String(parsed.image ?? ""),
      tags: String(parsed.tags ?? ""),
      content,
      visibility: parsed.visibility === "space" ? "space" : "public",
      spaceId: String(parsed.spaceId ?? ""),
      channelId: String(parsed.channelId ?? ""),
    },
    at,
  );
  return id;
}
