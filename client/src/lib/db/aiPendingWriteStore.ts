import type { PendingWrite } from "@/types/ai";
import { getDB, type TheWiredDB } from "./database";

/**
 * Per-account persistence for AI pending writes (model-proposed drafts awaiting
 * the human approval gate). Pre-audit these were Redux-only: a reload silently
 * dropped drafts the persisted conversation still claimed were awaiting
 * approval (audit #98). Approval/signing stays exclusively in
 * `gate/approveWrite.ts` — this module only stores state.
 */

type StoredWrite = TheWiredDB["aiPendingWrites"]["value"];

/** Drafts wait this long for approval; older ones hydrate as `expired`. */
export const PENDING_WRITE_TTL_MS = 24 * 60 * 60 * 1000;

function strip(stored: StoredWrite): PendingWrite {
  const { _account, _cachedAt, ...write } = stored;
  void _account;
  void _cachedAt;
  return write;
}

export async function putPendingWrite(
  write: PendingWrite,
  account: string,
): Promise<void> {
  const db = await getDB();
  await db.put("aiPendingWrites", {
    ...write,
    _account: account,
    _cachedAt: Date.now(),
  });
}

/**
 * Load an account's pending writes, normalizing states that must not survive a
 * reload as-is:
 *  - `pending` older than the TTL → `expired` (unsignable; approveWrite refuses
 *    anything that isn't pending/error);
 *  - `publishing` → `error` (the app died mid-publish; the user can judge
 *    whether to retry — the card says it may or may not have gone out).
 * Normalizations are written back so they stick.
 */
export async function loadPendingWritesForAccount(
  account: string,
): Promise<PendingWrite[]> {
  const db = await getDB();
  const rows = await db.getAllFromIndex("aiPendingWrites", "by_account", account);
  const now = Date.now();
  const out: PendingWrite[] = [];
  const flips: StoredWrite[] = [];

  for (const row of rows) {
    let write = strip(row);
    if (write.status === "pending" && now - write.createdAt > PENDING_WRITE_TTL_MS) {
      write = { ...write, status: "expired" };
      flips.push({ ...row, ...write });
    } else if (write.status === "publishing") {
      write = {
        ...write,
        status: "error",
        error: "Interrupted by a reload while publishing — it may or may not have been sent.",
      };
      flips.push({ ...row, ...write });
    }
    out.push(write);
  }

  if (flips.length > 0) {
    const tx = db.transaction("aiPendingWrites", "readwrite");
    for (const flip of flips) tx.store.put({ ...flip, _cachedAt: now });
    await tx.done;
  }

  return out.sort((a, b) => a.createdAt - b.createdAt);
}

export async function deletePendingWrite(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("aiPendingWrites", id);
}
