import { api } from "./client";

interface Invite {
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

export async function createInvite(params: {
  spaceId: string;
  maxUses?: number;
  expiresInHours?: number;
  label?: string;
  autoAssignRole?: string;
}) {
  return api<{ code: string }>("/invites", { method: "POST", body: params });
}

export async function getInvite(code: string) {
  return api<Invite>(`/invites/${encodeURIComponent(code)}`);
}

export async function revokeInvite(code: string) {
  return api<{ success: boolean }>(`/invites/${encodeURIComponent(code)}`, { method: "DELETE" });
}
