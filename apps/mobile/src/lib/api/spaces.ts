// Space detail + channels + membership + roles over the backend API (through
// the gateway). GETs are public — guests browse spaces (5.1.1(v)); join/leave
// and my-spaces are authenticated via NIP-98 (services/backend/src/routes/
// members.ts, spaces.ts).

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
  category: string | null;
  /** "read" (feed space) | "read-write" (community). */
  mode: string;
  memberCount: number;
  activeMembers24h: number;
  messagesLast24h: number;
  featured: boolean;
  /** Unix seconds; null on legacy rows. */
  createdAt: number | null;
  creatorPubkey: string | null;
}

export interface SpaceChannel {
  id: string;
  type: string;
  label: string;
  isDefault: boolean;
  categoryId: string | null;
  position: number;
  adminOnly: boolean;
  slowModeSeconds: number;
  feedMode: "all" | "curated";
}

export interface SpaceRoleInfo {
  id: string;
  name: string;
  position: number;
  color: string | null;
  isDefault: boolean;
  isAdmin: boolean;
}

export interface SpaceMemberRoles {
  pubkey: string;
  roles: SpaceRoleInfo[];
}

/** The minimal space shape GET /spaces/my-spaces embeds (no spaceMode/tags). */
export interface MySpace {
  id: string;
  name: string;
  about: string | null;
  picture: string | null;
  hostRelay: string | null;
  mode: string;
  memberCount: number;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Envelope-free field parse — shared by the detail GET and my-spaces rows. */
export function parseSpaceDetailFields(raw: unknown): SpaceDetail | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
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
    category: str(obj.category),
    mode: str(obj.mode) ?? "read-write",
    memberCount: num(obj.memberCount),
    activeMembers24h: num(obj.activeMembers24h),
    messagesLast24h: num(obj.messagesLast24h),
    featured: obj.featured === true,
    createdAt: typeof obj.createdAt === "number" ? obj.createdAt : null,
    creatorPubkey: str(obj.creatorPubkey),
  };
}

export function parseSpaceDetail(payload: unknown): SpaceDetail | null {
  return parseSpaceDetailFields((payload as { data?: unknown } | null)?.data);
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
      categoryId: str(obj.categoryId),
      position: num(obj.position),
      adminOnly: obj.adminOnly === true,
      slowModeSeconds: num(obj.slowModeSeconds),
      feedMode: obj.feedMode === "curated" ? "curated" : "all",
    });
  }
  return out.sort((a, b) => a.position - b.position);
}

function parseRole(raw: unknown): SpaceRoleInfo | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id !== "string" || typeof obj.name !== "string") return null;
  return {
    id: obj.id,
    name: obj.name,
    position: num(obj.position),
    color: str(obj.color),
    isDefault: obj.isDefault === true,
    isAdmin: obj.isAdmin === true,
  };
}

export function parseSpaceRoles(payload: unknown): SpaceRoleInfo[] {
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  return data
    .map(parseRole)
    .filter((r): r is SpaceRoleInfo => r !== null)
    .sort((a, b) => a.position - b.position);
}

export function parseSpaceMemberRoles(payload: unknown): SpaceMemberRoles[] {
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  const out: SpaceMemberRoles[] = [];
  for (const raw of data) {
    if (typeof raw !== "object" || raw === null) continue;
    const obj = raw as Record<string, unknown>;
    if (typeof obj.pubkey !== "string") continue;
    const roles = Array.isArray(obj.roles)
      ? obj.roles.map(parseRole).filter((r): r is SpaceRoleInfo => r !== null)
      : [];
    out.push({ pubkey: obj.pubkey, roles });
  }
  return out;
}

export function parseMySpaces(payload: unknown): MySpace[] {
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  const out: MySpace[] = [];
  for (const raw of data) {
    const space = (raw as { space?: unknown } | null)?.space;
    if (typeof space !== "object" || space === null) continue;
    const obj = space as Record<string, unknown>;
    if (typeof obj.id !== "string" || typeof obj.name !== "string") continue;
    out.push({
      id: obj.id,
      name: obj.name,
      about: str(obj.about),
      picture: str(obj.picture),
      hostRelay: str(obj.hostRelay),
      mode: str(obj.mode) ?? "read-write",
      memberCount: num(obj.memberCount),
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

/** Curated feed-source pubkeys (feed-mode spaces + curated channels). */
export async function fetchFeedSources(spaceId: string): Promise<string[]> {
  const response = await fetch(
    `${API_BASE}/spaces/${encodeURIComponent(spaceId)}/feed-sources`,
  );
  if (!response.ok) return [];
  const data = ((await response.json()) as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data.filter((p): p is string => typeof p === "string");
}

export async function fetchSpaceRoles(spaceId: string): Promise<SpaceRoleInfo[]> {
  const response = await fetch(
    `${API_BASE}/spaces/${encodeURIComponent(spaceId)}/roles`,
  );
  if (!response.ok) return [];
  return parseSpaceRoles(await response.json());
}

export async function fetchSpaceMemberRoles(spaceId: string): Promise<SpaceMemberRoles[]> {
  const response = await fetch(
    `${API_BASE}/spaces/${encodeURIComponent(spaceId)}/member-roles`,
  );
  if (!response.ok) return [];
  return parseSpaceMemberRoles(await response.json());
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

/** Leave a space: authenticated DELETE via NIP-98. */
export async function leaveSpace(spaceId: string, signer: EventSigner): Promise<void> {
  const url = `${API_BASE}/spaces/${encodeURIComponent(spaceId)}/members/me`;
  const authorization = await buildNip98Header(signer, url, "DELETE");
  const response = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: authorization },
  });
  if (!response.ok) {
    throw new Error(`Couldn't leave (${response.status}).`);
  }
}

/** The caller's joined spaces (NIP-98 GET /spaces/my-spaces). */
export async function fetchMySpaces(signer: EventSigner): Promise<MySpace[]> {
  const url = `${API_BASE}/spaces/my-spaces`;
  const authorization = await buildNip98Header(signer, url, "GET");
  const response = await fetch(url, { headers: { Authorization: authorization } });
  if (!response.ok) throw new Error(`My spaces unavailable (${response.status})`);
  return parseMySpaces(await response.json());
}
