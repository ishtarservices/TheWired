// The shared-project key DM (soot docs/collab-shared-key.md §2): a NIP-17 gift
// wrap whose rumor is kind 20017, carrying a project's nsec 1:1 to a new key
// holder (plus a self-wrap for the sender's other devices).
//
// Kind 20017 is not in core's DM_RUMOR_KINDS yet, so the inbox unwraps with
// GIFT_WRAP_ACCEPT_KINDS and intercepts it BEFORE parseDMWire, which would
// otherwise drop it as an unsupported kind. It must never reach dmSlice, the
// DM IndexedDB store or a log line.

import { DM_RUMOR_KINDS, type UnwrappedDM } from "@ishtarservices/core";
import { getPublicKey } from "nostr-tools/pure";
import { decode, nsecEncode } from "nostr-tools/nip19";

export const KIND_DM_PROJECT_KEY = 20017;

/** Rumor kinds the inbox unwraps: the DM set plus the project key DM. */
export const GIFT_WRAP_ACCEPT_KINDS: readonly number[] = [...DM_RUMOR_KINDS, KIND_DM_PROJECT_KEY];

const PROJECT_COORD_RE = /^33123:([0-9a-f]{64}):.+$/;

/** A validated key DM. `secretKey` is the project secret: hand it straight to
 *  the keychain store and drop the reference. */
export interface ProjectKeyGrant {
  projectPubkey: string;
  /** `33123:<projectpk>:<d>` */
  coord: string;
  secretKey: Uint8Array;
  /** Rumor created_at (the real send time; only seal + wrap are randomized). */
  sentAt: number;
}

/** The project pubkey inside a `33123:<pk>:<d>` coordinate, or null. */
export function projectPubkeyOf(coord: string): string | null {
  return PROJECT_COORD_RE.exec(coord)?.[1] ?? null;
}

/**
 * Apply the §2 receive rules to an unwrapped rumor. Any miss returns null and
 * the caller drops the wrap silently. Blocked senders are filtered by the
 * caller before this runs.
 */
export function parseProjectKeyDM(
  dm: Pick<UnwrappedDM, "kind" | "sender" | "tags" | "content" | "createdAt">,
  myPubkey: string,
): ProjectKeyGrant | null {
  if (dm.kind !== KIND_DM_PROJECT_KEY) return null;

  // 1:1 only: no room id, exactly one recipient, and I am one of the two
  // participants (my own self-wrap echo counts: my other device shared it).
  if (dm.tags.some((t) => t[0] === "g")) return null;
  const recipients = dm.tags.filter((t) => t[0] === "p");
  if (recipients.length !== 1) return null;
  const recipient = recipients[0][1];
  if (dm.sender !== myPubkey && recipient !== myPubkey) return null;

  let body: unknown;
  try {
    body = JSON.parse(dm.content);
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null) return null;
  const { v, a, nsec } = body as Record<string, unknown>;
  if (v !== 1 || typeof a !== "string" || typeof nsec !== "string") return null;

  const projectPubkey = projectPubkeyOf(a);
  // A project key is never an account key; refuse to file one as a project.
  if (!projectPubkey || projectPubkey === myPubkey) return null;

  let secretKey: Uint8Array;
  try {
    const decoded = decode(nsec);
    if (decoded.type !== "nsec") return null;
    secretKey = decoded.data;
  } catch {
    return null;
  }
  if (secretKey.length !== 32) return null;
  try {
    if (getPublicKey(secretKey) !== projectPubkey) return null;
  } catch {
    return null;
  }

  return { projectPubkey, coord: a, secretKey, sentAt: dm.createdAt };
}

/** Rumor content for a key DM. */
export function buildProjectKeyDMContent(coord: string, secretKey: Uint8Array): string {
  return JSON.stringify({ v: 1, a: coord, nsec: nsecEncode(secretKey) });
}
