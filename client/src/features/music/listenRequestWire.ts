import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import type { UnsignedEvent } from "@/types/nostr";
import type { ProposalChange } from "@/types/music";
import { buildProposalEvent } from "./musicEventBuilder";

/**
 * Listen requests — "let me hear this private release" — on the wire the
 * mobile app (soot) already speaks. A request rides the proposal kind
 * (31685) with the same d / a / owner-p / status tags, so the backend indexes
 * it into the owner's inbox unchanged, and carries exactly one change:
 * `{ type: "grant_access", role: "viewer" }`.
 *
 * The d-tag is DETERMINISTIC per target, so asking again replaces the same
 * addressable event instead of minting a new one. Must stay byte-identical
 * with soot's derivation.
 */

export const LISTEN_REQUEST_TITLE = "listen request";

/** The backend refuses a fresh ask for 7 days after a decline; the requester
 *  UI only offers "Ask again" once that long has passed. */
export const LISTEN_REQUEST_COOLDOWN_SEC = 7 * 24 * 60 * 60;

export const LISTEN_REQUEST_CHANGE: ProposalChange = { type: "grant_access", role: "viewer" };

export type ListenTargetKind = 31683 | 33123;

export interface ListenTarget {
  ref: string;
  kind: ListenTargetKind;
  ownerPubkey: string;
  d: string;
}

const TARGET_REF = /^(31683|33123):([0-9a-f]{64}):(.+)$/;

/** `31683:<owner>:<d>` (track) or `33123:<owner>:<d>` (project) — null otherwise. */
export function parseListenTarget(ref: string): ListenTarget | null {
  const m = TARGET_REF.exec(ref);
  if (!m) return null;
  return { ref, kind: Number(m[1]) as ListenTargetKind, ownerPubkey: m[2], d: m[3] };
}

/** `"req-" + first 16 hex chars of sha256(utf8(targetRef))`. */
export function listenRequestId(targetRef: string): string {
  return `req-${bytesToHex(sha256(utf8ToBytes(targetRef))).slice(0, 16)}`;
}

/** A row/proposal is a listen request iff any change asks for access. */
export function isListenRequest(proposal: { changes: readonly ProposalChange[] }): boolean {
  return proposal.changes.some((c) => c.type === "grant_access");
}

/** Build the kind-31685 listen request for `targetRef`. Throws on a malformed
 *  ref or when asking for your own release. */
export function buildListenRequestEvent(pubkey: string, targetRef: string): UnsignedEvent {
  const target = parseListenTarget(targetRef);
  if (!target) throw new Error("Not a track or project address.");
  if (target.ownerPubkey === pubkey) throw new Error("That's your own release.");
  return buildProposalEvent(pubkey, {
    proposalId: listenRequestId(targetRef),
    targetAlbum: targetRef,
    ownerPubkey: target.ownerPubkey,
    title: LISTEN_REQUEST_TITLE,
    changes: [{ ...LISTEN_REQUEST_CHANGE }],
  });
}

/** Can the requester ask again? Only once the cooldown since their stored
 *  request has passed. */
export function canAskAgain(requestedAt: number, nowSec: number = Math.floor(Date.now() / 1000)): boolean {
  return nowSec - requestedAt >= LISTEN_REQUEST_COOLDOWN_SEC;
}
