import { api } from "./client";
import type { SpaceRole, ChannelPermissionOverride } from "../../types/space";

export async function fetchRoles(spaceId: string): Promise<SpaceRole[]> {
  const res = await api<SpaceRole[]>(`/spaces/${spaceId}/roles`);
  return res.data;
}

export async function createRole(
  spaceId: string,
  params: { name: string; color?: string; permissions: string[]; isAdmin?: boolean },
): Promise<SpaceRole> {
  const res = await api<SpaceRole>(`/spaces/${spaceId}/roles`, {
    method: "POST",
    body: params,
  });
  return res.data;
}

export async function updateRole(
  spaceId: string,
  roleId: string,
  params: { name?: string; color?: string; permissions?: string[] },
): Promise<SpaceRole> {
  const res = await api<SpaceRole>(`/spaces/${spaceId}/roles/${roleId}`, {
    method: "PATCH",
    body: params,
  });
  return res.data;
}

export async function deleteRole(spaceId: string, roleId: string): Promise<void> {
  await api(`/spaces/${spaceId}/roles/${roleId}`, { method: "DELETE" });
}

export async function reorderRoles(spaceId: string, orderedIds: string[]): Promise<void> {
  await api(`/spaces/${spaceId}/roles/reorder`, {
    method: "POST",
    body: { orderedIds },
  });
}

export async function fetchMemberRoles(spaceId: string, pubkey: string): Promise<SpaceRole[]> {
  const res = await api<SpaceRole[]>(`/spaces/${spaceId}/members/${pubkey}/roles`);
  return res.data;
}

export async function assignRole(spaceId: string, pubkey: string, roleId: string): Promise<void> {
  await api(`/spaces/${spaceId}/members/${pubkey}/roles`, {
    method: "POST",
    body: { roleId },
  });
}

export async function removeRoleFromMember(
  spaceId: string,
  pubkey: string,
  roleId: string,
): Promise<void> {
  await api(`/spaces/${spaceId}/members/${pubkey}/roles/${roleId}`, { method: "DELETE" });
}

export async function fetchChannelOverrides(
  spaceId: string,
  roleId: string,
): Promise<ChannelPermissionOverride[]> {
  const res = await api<ChannelPermissionOverride[]>(
    `/spaces/${spaceId}/roles/${roleId}/overrides`,
  );
  return res.data;
}

export async function setChannelOverrides(
  spaceId: string,
  roleId: string,
  overrides: Array<{ channelId: string; allow: string[]; deny: string[] }>,
): Promise<void> {
  await api(`/spaces/${spaceId}/roles/${roleId}/overrides`, {
    method: "PUT",
    body: { overrides },
  });
}

export async function fetchMyPermissions(spaceId: string): Promise<string[]> {
  const res = await api<string[]>(`/spaces/${spaceId}/permissions/me`);
  return res.data;
}
