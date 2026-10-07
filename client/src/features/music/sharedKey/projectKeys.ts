// Runtime side of shared-project keys for the active account: Redux holds the
// non-secret `{ projectpk -> coord }` map; signers are built on demand from the
// keychain, cached for the session, and dropped on account switch or logout.

import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { store } from "@/store";
import { addHeldProjectKey, removeHeldProjectKey, setHeldProjectKeys } from "@/store/slices/musicSlice";
import { ProjectKeySigner } from "@/lib/nostr/projectKeySigner";
import { forgetProjectKey, listProjectKeys, loadProjectSecret, saveProjectKey } from "./projectKeyStore";
import type { ProjectKeyGrant } from "./projectKeyDM";

const signers = new Map<string, ProjectKeySigner>();
/** Bumped on every session teardown so in-flight keychain reads can't land in
 *  the next account's state. */
let generation = 0;

type HeldKeyListener = (projectPubkey: string) => void;
const addedListeners = new Set<HeldKeyListener>();

/** Notified when this session starts holding a new key (to widen subscriptions). */
export function onProjectKeyAdded(listener: HeldKeyListener): () => void {
  addedListeners.add(listener);
  return () => addedListeners.delete(listener);
}

function isActive(accountPubkey: string, gen: number): boolean {
  return gen === generation && store.getState().identity.pubkey === accountPubkey;
}

/** Load the account's held keys into Redux. Returns their project pubkeys. */
export async function hydrateHeldProjectKeys(accountPubkey: string): Promise<string[]> {
  const gen = generation;
  const held = await listProjectKeys(accountPubkey);
  if (!isActive(accountPubkey, gen)) return [];
  store.dispatch(setHeldProjectKeys(held));
  await retireMovedProjectKeys();
  return Object.keys(store.getState().music.heldProjectKeys ?? {});
}

/**
 * Forget every held key whose releases a recorded rotation stub replaced. The
 * live pipeline does this when a stub arrives; this covers the other orders: a
 * stub restored from IndexedDB at startup (it never re-enters the pipeline), or
 * a key re-learned from an old key DM after a reload lost its tombstone (web
 * session memory). Idempotent.
 */
export async function retireMovedProjectKeys(): Promise<void> {
  const music = store.getState().music;
  const held = Object.keys(music.heldProjectKeys ?? {});
  if (held.length === 0) return;
  const movedAuthors = new Set(Object.keys(music.movedReleases ?? {}).map((addr) => addr.split(":")[1]));
  for (const pk of held) {
    if (movedAuthors.has(pk)) await forgetHeldProjectKey(pk);
  }
}

/** Drop cached signers; call on account switch and logout. */
export function clearProjectKeySession(): void {
  generation++;
  signers.clear();
}

export function isHeldProjectKey(pubkey: string): boolean {
  return pubkey in (store.getState().music.heldProjectKeys ?? {});
}

/** The signer for a held project key, or null if this device doesn't hold it. */
export async function getProjectSigner(projectPubkey: string): Promise<ProjectKeySigner | null> {
  const account = store.getState().identity.pubkey;
  if (!account || !isHeldProjectKey(projectPubkey)) return null;
  const cached = signers.get(projectPubkey);
  if (cached) return cached;

  const gen = generation;
  const secretKey = await loadProjectSecret(account, projectPubkey);
  if (!secretKey || !isActive(account, gen)) return null;
  const signer = new ProjectKeySigner(secretKey);
  if (signer.pubkey !== projectPubkey) return null;
  signers.set(projectPubkey, signer);
  return signer;
}

/**
 * Store a key from a validated key DM (or one made on this device). Resolves
 * once the outcome is final, so the caller can mark the wrap processed; throws
 * only when the keychain write fails (the wrap is then retried on replay).
 */
export async function receiveProjectKey(grant: ProjectKeyGrant, accountPubkey: string): Promise<void> {
  const gen = generation;
  const result = await saveProjectKey(accountPubkey, grant);
  if (result !== "stored" && result !== "known") return;
  if (!isActive(accountPubkey, gen)) return;
  const isNew = !isHeldProjectKey(grant.projectPubkey);
  store.dispatch(addHeldProjectKey({ pubkey: grant.projectPubkey, coord: grant.coord }));
  await retireMovedProjectKeys();
  if (isNew && isHeldProjectKey(grant.projectPubkey)) {
    for (const listener of addedListeners) listener(grant.projectPubkey);
  }
}

/** Forget a held key on this device (leave, or a moved stub it signed). */
export async function forgetHeldProjectKey(projectPubkey: string): Promise<void> {
  const account = store.getState().identity.pubkey;
  if (!account) return;
  signers.delete(projectPubkey);
  store.dispatch(removeHeldProjectKey(projectPubkey));
  await forgetProjectKey(account, projectPubkey);
}

/** Mint the key for a new shared project on this device and hold it. The
 *  project's events are then signed by `signer`; `coord` is its 33123 address. */
export async function createProjectKey(
  accountPubkey: string,
  slug: string,
): Promise<{ signer: ProjectKeySigner; coord: string }> {
  const secretKey = generateSecretKey();
  const projectPubkey = getPublicKey(secretKey);
  const coord = `33123:${projectPubkey}:${slug}`;
  await receiveProjectKey(
    { projectPubkey, coord, secretKey, sentAt: Math.floor(Date.now() / 1000) },
    accountPubkey,
  );
  const signer = await getProjectSigner(projectPubkey);
  if (!signer) throw new Error("Couldn't store the project key on this device.");
  return { signer, coord };
}
