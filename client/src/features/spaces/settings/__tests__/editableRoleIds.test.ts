import { describe, it, expect } from "vitest";
import { editableRoleIds } from "../MembersTab";
import type { SpaceRole } from "@/types/space";

const role = (id: string, position: number, extra: Partial<SpaceRole> = {}): SpaceRole => ({
  id,
  spaceId: "sp",
  name: id,
  position,
  isDefault: false,
  isAdmin: false,
  permissions: [],
  ...extra,
});
const ADMIN = role("admin", 0, { isAdmin: true });
const MOD = role("mod", 1);
const MEMBER = role("member", 2, { isDefault: true });
const ALL = [ADMIN, MOD, MEMBER];

describe("editableRoleIds (mirrors backend roles.ts assign/remove)", () => {
  it("is empty without MANAGE_MEMBERS", () => {
    expect(editableRoleIds({ allRoles: ALL, viewerRoles: [ADMIN], viewerIsCreator: true, targetIsCreator: false, canManageMembers: false }).size).toBe(0);
  });
  it("the creator may toggle every role, on anyone", () => {
    const ids = editableRoleIds({ allRoles: ALL, viewerRoles: [], viewerIsCreator: true, targetIsCreator: false, canManageMembers: true });
    expect([...ids].sort()).toEqual(["admin", "member", "mod"]);
  });
  it("an admin may toggle roles strictly below Admin, never Admin itself", () => {
    const ids = editableRoleIds({ allRoles: ALL, viewerRoles: [ADMIN], viewerIsCreator: false, targetIsCreator: false, canManageMembers: true });
    expect([...ids].sort()).toEqual(["member", "mod"]);
  });
  it("nobody but the creator touches the creator's roles", () => {
    expect(editableRoleIds({ allRoles: ALL, viewerRoles: [ADMIN], viewerIsCreator: false, targetIsCreator: true, canManageMembers: true }).size).toBe(0);
  });
  it("a viewer with no roles (rank ∞) can't toggle anything", () => {
    expect(editableRoleIds({ allRoles: ALL, viewerRoles: [], viewerIsCreator: false, targetIsCreator: false, canManageMembers: true }).size).toBe(0);
  });
});
