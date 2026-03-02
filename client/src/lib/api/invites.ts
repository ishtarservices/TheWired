import { api } from "./client";

export interface Invite {
  code: string;
  spaceId: string;
  createdBy: string;
  maxUses: number | null;
  useCount: number;
  expiresAt: number | null;
  revoked: boolean;
  label: string | null;
  autoAssignRole: string | null;
}

export interface SpacePreview {
  name: string;
  picture: string | null;
  about: string | null;
  memberCount: number;
  mode?: "read" | "read-write";
}

export interface InviteWithPreview extends Invite {
  space: SpacePreview;
}

export interface RedeemResult {
  spaceId: string;
  space: SpacePreview | null;
}

export async function createInvite(params: {
  spaceId: string;
  maxUses?: number;
  expiresInHours?: number;
  label?: string;
  autoAssignRole?: string;
}) {
  return api<{ code: string }>("/invites", { method: "POST", body: params });
}

export async function getInviteWithPreview(code: string) {
  return api<InviteWithPreview>(`/invites/${encodeURIComponent(code)}`, { auth: false });
}

export async function redeemInvite(code: string) {
  return api<RedeemResult>(`/invites/${encodeURIComponent(code)}/redeem`, { method: "POST" });
}

export async function listSpaceInvites(spaceId: string) {
  return api<Invite[]>(`/invites/space/${encodeURIComponent(spaceId)}`);
}

export async function revokeInvite(code: string) {
  return api<{ success: boolean }>(`/invites/${encodeURIComponent(code)}`, { method: "DELETE" });
}
