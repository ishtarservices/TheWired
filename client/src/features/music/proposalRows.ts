import type { MusicProposal, ProposalChange } from "@/types/music";

/**
 * Defensive parse of the backend's kind-31685 rows (`{ data: rows[] }` from
 * `/music/proposals/incoming` and `/music/proposals/:pubkey/:slug`). Rows are
 * written from relay events anyone can publish, so a malformed row is
 * dropped, never thrown. Mirrors soot's `lib/api/proposals.ts`.
 */

const CHANGE_TYPES: ReadonlySet<ProposalChange["type"]> = new Set([
  "add_track",
  "remove_track",
  "reorder",
  "update_metadata",
  "grant_access",
]);
const HEX64 = /^[0-9a-f]{64}$/;

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function int(v: unknown): number | undefined {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : undefined;
}

/** One change, or null when it can't mean anything (bad type, missing ref). */
export function parseProposalChange(raw: unknown): ProposalChange | null {
  if (typeof raw !== "object" || raw === null) return null;
  const c = raw as Record<string, unknown>;
  const type = c.type as ProposalChange["type"];
  if (!CHANGE_TYPES.has(type)) return null;
  const out: ProposalChange = { type };
  if (type === "grant_access") {
    if (c.role !== "viewer") return null;
    out.role = "viewer";
  } else if (type === "add_track" || type === "remove_track") {
    const trackRef = str(c.trackRef);
    if (!trackRef?.startsWith("31683:")) return null;
    out.trackRef = trackRef;
    const position = int(c.position);
    if (type === "add_track" && position !== undefined) out.position = position;
  } else if (type === "reorder") {
    const from = int(c.from);
    const to = int(c.to);
    if (from === undefined || to === undefined) return null;
    out.from = from;
    out.to = to;
  } else {
    const field = str(c.field);
    const value = typeof c.value === "string" ? c.value : undefined;
    if (!field || value === undefined) return null;
    out.field = field;
    out.value = value;
  }
  return out;
}

export function parseProposalRow(raw: unknown): MusicProposal | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  const proposalId = str(r.proposalId);
  const targetAlbum = str(r.targetAlbum);
  const proposerPubkey = str(r.proposerPubkey);
  const ownerPubkey = str(r.ownerPubkey);
  const status = r.status;
  const createdAt = int(r.createdAt);
  if (!id || !proposalId) return null;
  if (!targetAlbum?.startsWith("33123:") && !targetAlbum?.startsWith("31683:")) return null;
  if (!proposerPubkey || !HEX64.test(proposerPubkey)) return null;
  if (!ownerPubkey || !HEX64.test(ownerPubkey)) return null;
  if (status !== "open" && status !== "accepted" && status !== "rejected") return null;
  if (createdAt === undefined) return null;
  const rawChanges = Array.isArray(r.changes) ? r.changes : [];
  const changes = rawChanges
    .map(parseProposalChange)
    .filter((c): c is ProposalChange => c !== null);
  if (changes.length === 0) return null;
  // A single-track target only makes sense for a listen request — a tracklist
  // change against a track is nothing the owner's app can apply.
  if (targetAlbum.startsWith("31683:") && !changes.every((c) => c.type === "grant_access")) {
    return null;
  }
  const description = str(r.description);
  const eventId = str(r.eventId);
  const resolvedAt = int(r.resolvedAt);
  return {
    id,
    proposalId,
    addressableId: str(r.addressableId) ?? `31685:${proposerPubkey}:${proposalId}`,
    targetAlbum,
    proposerPubkey,
    ownerPubkey,
    title: str(r.title) ?? "",
    ...(description ? { description } : {}),
    changes,
    status,
    ...(eventId ? { eventId } : {}),
    createdAt,
    ...(resolvedAt !== undefined ? { resolvedAt } : {}),
  };
}

/** `{ data: rows[] }` → proposals; anything else → []. */
export function parseProposalRows(payload: unknown): MusicProposal[] {
  const data = (payload as { data?: unknown } | null | undefined)?.data;
  if (!Array.isArray(data)) return [];
  return data.map(parseProposalRow).filter((p): p is MusicProposal => p !== null);
}
