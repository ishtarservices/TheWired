// Space detail + channels + membership over the backend API (through the
// gateway). GETs are public — guests browse spaces (5.1.1(v)); the join POST
// is authenticated via NIP-98 (services/backend/src/routes/members.ts
// POST /:id/members/me).

import { API_BASE } from "./discovery";
import { buildNip98Header } from "@/lib/nostr/nip98";
import type { EventSigner } from "@/core/adapters";

export interface SpaceDetail {
  id: string;
  name: string;
  about: string | null;
  picture: string | null;
  hostRelay: string | null;
  spaceMode: string;
  tags: string[];
}

export interface SpaceChannel {
  id: string;
  type: string;
  label: string;
  isDefault: boolean;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function parseSpaceDetail(payload: unknown): SpaceDetail | null {
  const data = (payload as { data?: unknown } | null)?.data;
  if (typeof data !== "object" || data === null) return null;
  const obj = data as Record<string, unknown>;
  if (typeof obj.id !== "string" || typeof obj.name !== "string") return null;
  return {
    id: obj.id,
    name: obj.name,
    about: str(obj.about),
    picture: str(obj.picture),
    hostRelay: str(obj.hostRelay),
    spaceMode: str(obj.spaceMode) ?? "platform",
    tags: Array.isArray(obj.tags)
      ? obj.tags.filter((t): t is string => typeof t === "string")
      : [],
  };
}

export function parseSpaceChannels(payload: unknown): SpaceChannel[] {
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  const out: SpaceChannel[] = [];
  for (const raw of data) {
    if (typeof raw !== "object" || raw === null) continue;
    const obj = raw as Record<string, unknown>;
    if (typeof obj.id !== "string" || typeof obj.type !== "string") continue;
    const label = typeof obj.label === "string" ? obj.label : obj.type;
    out.push({
      id: obj.id,
      type: obj.type,
      // Backend labels may carry a leading "#" — the UI adds its own.
      label: label.replace(/^#/, ""),
      isDefault: obj.isDefault === true,
    });
  }
  return out;
}

export async function fetchSpaceDetail(spaceId: string): Promise<SpaceDetail> {
  const response = await fetch(`${API_BASE}/spaces/${encodeURIComponent(spaceId)}`);
  if (!response.ok) throw new Error(`Space unavailable (${response.status})`);
  const detail = parseSpaceDetail(await response.json());
  if (!detail) throw new Error("Space unavailable (bad response)");
  return detail;
}

export async function fetchSpaceChannels(spaceId: string): Promise<SpaceChannel[]> {
  const response = await fetch(
    `${API_BASE}/spaces/${encodeURIComponent(spaceId)}/channels`,
  );
  if (!response.ok) throw new Error(`Channels unavailable (${response.status})`);
  return parseSpaceChannels(await response.json());
}

/** Public members list — used to know whether WE are a member (join CTA). */
export async function fetchSpaceMemberPubkeys(spaceId: string): Promise<string[]> {
  const response = await fetch(
    `${API_BASE}/spaces/${encodeURIComponent(spaceId)}/members`,
  );
  if (!response.ok) return [];
  const data = ((await response.json()) as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data
    .map((m) =>
      typeof m === "string"
        ? m
        : typeof (m as { pubkey?: unknown })?.pubkey === "string"
          ? (m as { pubkey: string }).pubkey
          : null,
    )
    .filter((p): p is string => p !== null);
}

/** Join a platform space: authenticated POST via NIP-98 over the signer. */
export async function joinSpace(spaceId: string, signer: EventSigner): Promise<void> {
  const url = `${API_BASE}/spaces/${encodeURIComponent(spaceId)}/members/me`;
  const authorization = await buildNip98Header(signer, url, "POST");
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: authorization },
  });
  if (!response.ok) {
    throw new Error(
      response.status === 401
        ? "The relay gateway rejected the signature. Try again."
        : `Couldn't join (${response.status}).`,
    );
  }
}
