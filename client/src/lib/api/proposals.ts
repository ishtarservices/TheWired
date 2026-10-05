import { api, ApiRequestError } from "./client";
import type { MusicProposal } from "@/types/music";
import { parseProposalRows } from "@/features/music/proposalRows";

/**
 * Kind-31685 proposals over the backend. The relay carries the events; the
 * BACKEND owns their status (resolve flips a DB row, the event never changes),
 * so reads go through REST and the id we resolve by is the backend row id.
 */

/** Open proposals where the signed-in user is the owner (NIP-98 GET). */
export async function fetchIncomingProposals(): Promise<MusicProposal[]> {
  const res = await api<unknown>("/music/proposals/incoming", { priority: "low" });
  return parseProposalRows(res);
}

export type ResolveOutcome = "resolved" | "already-resolved";

/**
 * Owner-only: accept or reject one row (NIP-98 POST). 409 means someone (this
 * user on another device) already resolved it, and a vanished row (404) has
 * nothing left to resolve; both count as done.
 */
export async function resolveProposal(
  id: string,
  status: "accepted" | "rejected",
): Promise<ResolveOutcome> {
  try {
    await api(`/music/proposals/${encodeURIComponent(id)}/resolve`, {
      method: "POST",
      body: { status },
    });
    return "resolved";
  } catch (err) {
    if (err instanceof ApiRequestError) {
      if (err.status === 409 || err.status === 404) return "already-resolved";
      if (err.status === 403) throw new Error("Only the owner can answer this request.");
    }
    throw err;
  }
}
