// Keychain storage for shared-project keys (soot docs/collab-shared-key.md §3),
// scoped per account. The same entry names as mobile:
//
//   music.projectKey.<accountpk>.<projectpk> = {"nsec","a","at"}
//   music.projectKeys.<accountpk>            = {"v":1,"keys":[...],"gone":{...}}
//
// The keystore can't enumerate, so the index lists the slots (the
// `nwc_wallets_<pubkey>` one-blob pattern). `gone` maps a forgotten project
// pubkey to when it was forgotten: a key DM sent before that is a replay (the
// NIP-77 reconcile and the gift-wrap since-window both re-deliver old wraps)
// and is dropped, while a deliberate re-share after it is accepted.
//
// Secrets go through secretStore only: never Redux, IndexedDB or a log.

import { decode, nsecEncode } from "nostr-tools/nip19";
import { deleteSecret, getSecret, setSecret } from "@/lib/nostr/secretStore";

export const MAX_PROJECT_KEYS = 64;

export function projectKeySlot(accountPubkey: string, projectPubkey: string): string {
  return `music.projectKey.${accountPubkey}.${projectPubkey}`;
}

export function projectKeyIndexSlot(accountPubkey: string): string {
  return `music.projectKeys.${accountPubkey}`;
}

interface ProjectKeyIndex {
  v: 1;
  keys: string[];
  gone: Record<string, number>;
}

interface ProjectKeyRecord {
  nsec: string;
  a: string;
  at: number;
}

const HEX64_RE = /^[0-9a-f]{64}$/;

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function parseIndex(raw: string | null): ProjectKeyIndex {
  const empty: ProjectKeyIndex = { v: 1, keys: [], gone: {} };
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw) as Partial<ProjectKeyIndex>;
    if (parsed.v !== 1) return empty;
    const keys = Array.isArray(parsed.keys) ? parsed.keys.filter((k) => typeof k === "string" && HEX64_RE.test(k)) : [];
    const gone: Record<string, number> = {};
    if (parsed.gone && typeof parsed.gone === "object" && !Array.isArray(parsed.gone)) {
      for (const [pk, at] of Object.entries(parsed.gone)) {
        if (HEX64_RE.test(pk) && typeof at === "number") gone[pk] = at;
      }
    }
    return { v: 1, keys: [...new Set(keys)], gone };
  } catch {
    return empty;
  }
}

function parseRecord(raw: string | null): ProjectKeyRecord | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ProjectKeyRecord>;
    if (typeof parsed.nsec !== "string" || typeof parsed.a !== "string") return null;
    return { nsec: parsed.nsec, a: parsed.a, at: typeof parsed.at === "number" ? parsed.at : 0 };
  } catch {
    return null;
  }
}

/** Keep the newest MAX_PROJECT_KEYS tombstones. */
function capGone(gone: Record<string, number>): Record<string, number> {
  const entries = Object.entries(gone);
  if (entries.length <= MAX_PROJECT_KEYS) return gone;
  entries.sort((x, y) => y[1] - x[1]);
  return Object.fromEntries(entries.slice(0, MAX_PROJECT_KEYS));
}

// Index writes are read-modify-write on one keychain blob; serialize them so a
// burst of key DMs can't drop each other's entries.
let indexChain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = indexChain.then(fn, fn);
  indexChain = run.catch(() => {});
  return run;
}

async function readIndex(accountPubkey: string): Promise<ProjectKeyIndex> {
  return parseIndex(await getSecret(projectKeyIndexSlot(accountPubkey)));
}

async function writeIndex(accountPubkey: string, index: ProjectKeyIndex): Promise<void> {
  await setSecret(projectKeyIndexSlot(accountPubkey), JSON.stringify(index));
}

/** Held keys for an account: project pubkey -> its 33123 coordinate. Index
 *  entries whose slot is missing or unreadable are skipped. */
export async function listProjectKeys(accountPubkey: string): Promise<Record<string, string>> {
  const index = await readIndex(accountPubkey);
  const out: Record<string, string> = {};
  for (const pk of index.keys) {
    const record = parseRecord(await getSecret(projectKeySlot(accountPubkey, pk)));
    if (record) out[pk] = record.a;
  }
  return out;
}

/** The project secret for a held key, or null. */
export async function loadProjectSecret(accountPubkey: string, projectPubkey: string): Promise<Uint8Array | null> {
  const record = parseRecord(await getSecret(projectKeySlot(accountPubkey, projectPubkey)));
  if (!record) return null;
  try {
    const decoded = decode(record.nsec);
    return decoded.type === "nsec" ? decoded.data : null;
  } catch {
    return null;
  }
}

export type SaveProjectKeyResult = "stored" | "known" | "forgotten" | "full";

/**
 * Store a validated key. `sentAt` is the key DM's send time (or now for a key
 * made on this device); a key forgotten after that is a replay and is refused.
 */
export function saveProjectKey(
  accountPubkey: string,
  key: { projectPubkey: string; coord: string; secretKey: Uint8Array; sentAt: number },
): Promise<SaveProjectKeyResult> {
  return serialized(async () => {
    const index = await readIndex(accountPubkey);
    const goneAt = index.gone[key.projectPubkey];
    if (goneAt !== undefined && key.sentAt <= goneAt) return "forgotten";
    const known = index.keys.includes(key.projectPubkey);
    if (!known && index.keys.length >= MAX_PROJECT_KEYS) return "full";

    if (known) {
      const existing = parseRecord(await getSecret(projectKeySlot(accountPubkey, key.projectPubkey)));
      if (existing) return "known";
    }
    const record: ProjectKeyRecord = { nsec: nsecEncode(key.secretKey), a: key.coord, at: nowSec() };
    await setSecret(projectKeySlot(accountPubkey, key.projectPubkey), JSON.stringify(record));
    delete index.gone[key.projectPubkey];
    if (!known) index.keys.push(key.projectPubkey);
    await writeIndex(accountPubkey, index);
    return "stored";
  });
}

/** Delete a held key on this device and tombstone it (leave, or a moved stub
 *  signed by it). */
export function forgetProjectKey(accountPubkey: string, projectPubkey: string): Promise<void> {
  return serialized(async () => {
    const index = await readIndex(accountPubkey);
    await deleteSecret(projectKeySlot(accountPubkey, projectPubkey));
    index.keys = index.keys.filter((k) => k !== projectPubkey);
    index.gone = capGone({ ...index.gone, [projectPubkey]: nowSec() });
    await writeIndex(accountPubkey, index);
  });
}
