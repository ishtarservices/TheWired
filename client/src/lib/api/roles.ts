import { api } from "./client";
import type { SpaceRole, SpaceMember, ChannelPermissionOverride } from "../../types/space";

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

export async function fetchAllMemberRoles(spaceId: string): Promise<SpaceMember[]> {
  const res = await api<SpaceMember[]>(`/spaces/${spaceId}/member-roles`);
  return res.data;
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

/** Set one role's overrides on one channel (empty lists clear them). Only
 *  that channel stops following its subfolder's permissions. */
export async function setChannelOverride(
  spaceId: string,
  roleId: string,
  channelId: string,
  override: { allow: string[]; deny: string[] },
): Promise<void> {
  await api(`/spaces/${spaceId}/roles/${roleId}/overrides/${encodeURIComponent(channelId)}`, {
    method: "PUT",
    body: override,
  });
}

export interface CategoryPermissionOverride {
  roleId: string;
  categoryId: string;
  allow: string[];
  deny: string[];
}

/** A role's subfolder permission templates. */
export async function fetchCategoryOverrides(spaceId: string, roleId: string): Promise<CategoryPermissionOverride[]> {
  const res = await api<CategoryPermissionOverride[]>(`/spaces/${spaceId}/roles/${roleId}/category-overrides`);
  return res.data;
}

/** Replace a role's subfolder templates; synced channels in the touched subfolders follow. */
export async function setCategoryOverrides(
  spaceId: string,
  roleId: string,
  overrides: Array<{ categoryId: string; allow: string[]; deny: string[] }>,
): Promise<void> {
  await api(`/spaces/${spaceId}/roles/${roleId}/category-overrides`, {
    method: "PUT",
    body: { overrides },
  });
}

export async function fetchMyPermissions(spaceId: string): Promise<string[]> {
  const res = await api<string[]>(`/spaces/${spaceId}/permissions/me`);
  return res.data;
}

export interface ChannelPermissionsBatch {
  spacePermissions: string[];
  channelOverrides: Record<string, { allow: string[]; deny: string[] }>;
}

export async function fetchMyChannelPermissions(spaceId: string): Promise<ChannelPermissionsBatch> {
  const res = await api<ChannelPermissionsBatch>(`/spaces/${spaceId}/permissions/me/channels`);
  return res.data;
}
