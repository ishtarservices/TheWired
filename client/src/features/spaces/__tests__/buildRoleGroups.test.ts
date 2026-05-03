import { describe, it, expect } from "vitest";
import { buildRoleGroups } from "../buildRoleGroups";
import type { SpaceMember, SpaceRole } from "@/types/space";

function makeRole(overrides: Partial<SpaceRole> = {}): SpaceRole {
  return {
    id: "role-default",
    spaceId: "space-1",
    name: "Member",
    position: 100,
    isDefault: true,
    isAdmin: false,
    permissions: [],
    ...overrides,
  };
}

function makeMember(overrides: Partial<SpaceMember> = {}): SpaceMember {
  return { pubkey: "pk-1", roles: [], joinedAt: 1_000_000, ...overrides };
}

describe("buildRoleGroups", () => {
  const adminRole = makeRole({ id: "admin", name: "Admin", position: 1, color: "#ff0000", isAdmin: true, isDefault: false });
  const modRole = makeRole({ id: "mod", name: "Moderator", position: 50, color: "#00ff00", isDefault: false });
  const defaultRole = makeRole({ id: "default", name: "Members", position: 100, isDefault: true });

  it("groups members by their highest role (lowest position)", () => {
    const members: SpaceMember[] = [
      makeMember({ pubkey: "pk-admin", roles: [adminRole] }),
      makeMember({ pubkey: "pk-mod", roles: [modRole] }),
      makeMember({ pubkey: "pk-user", roles: [defaultRole] }),
    ];
    const groups = buildRoleGroups(members, [adminRole, modRole, defaultRole], [], "");

    expect(groups).toHaveLength(3);
    expect(groups[0].label).toBe("Admin");
    expect(groups[0].pubkeys).toEqual(["pk-admin"]);
    expect(groups[1].label).toBe("Moderator");
    expect(groups[1].pubkeys).toEqual(["pk-mod"]);
    expect(groups[2].label).toBe("Members");
    expect(groups[2].pubkeys).toEqual(["pk-user"]);
  });

  it("uses adminPubkeys fallback when member has no role rows but is in admin list", () => {
    // Creator who never had an explicit role row assigned.
    const members: SpaceMember[] = [
      makeMember({ pubkey: "pk-creator", roles: [] }),
      makeMember({ pubkey: "pk-user", roles: [defaultRole] }),
    ];
    const groups = buildRoleGroups(members, [adminRole, defaultRole], ["pk-creator"], "");

    const adminGroup = groups.find((g) => g.label === "Admin");
    expect(adminGroup?.pubkeys).toContain("pk-creator");
    const memberGroup = groups.find((g) => g.label === "Members");
    expect(memberGroup?.pubkeys).toEqual(["pk-user"]);
  });

  it("creator without any role row falls into Admin group via creatorPubkey fallback", () => {
    const members: SpaceMember[] = [
      makeMember({ pubkey: "pk-creator", roles: [] }),
    ];
    const groups = buildRoleGroups(members, [adminRole, defaultRole], [], "pk-creator");
    expect(groups.find((g) => g.label === "Admin")?.pubkeys).toEqual(["pk-creator"]);
  });

  it("highest role wins when a member has multiple roles", () => {
    const members: SpaceMember[] = [
      makeMember({ pubkey: "pk-multi", roles: [defaultRole, modRole] }),
    ];
    const groups = buildRoleGroups(members, [adminRole, modRole, defaultRole], [], "");
    expect(groups[0].label).toBe("Moderator");
    expect(groups[0].pubkeys).toEqual(["pk-multi"]);
  });

  it("members with empty roles fall into the default-named group", () => {
    const members: SpaceMember[] = [makeMember({ pubkey: "pk-orphan", roles: [] })];
    const groups = buildRoleGroups(members, [adminRole, defaultRole], [], "");
    // Should land in the "Members" (default) bucket — backend default-assigns on join,
    // so empty-roles is a legacy edge case.
    expect(groups[0].label).toBe("Members");
    expect(groups[0].pubkeys).toEqual(["pk-orphan"]);
  });

  it("returns empty groups when there are no members", () => {
    expect(buildRoleGroups([], [adminRole, defaultRole], [], "")).toEqual([]);
  });

  it("sorts groups by role position (highest rank first)", () => {
    const members: SpaceMember[] = [
      makeMember({ pubkey: "pk-user", roles: [defaultRole] }),
      makeMember({ pubkey: "pk-admin", roles: [adminRole] }),
      makeMember({ pubkey: "pk-mod", roles: [modRole] }),
    ];
    const groups = buildRoleGroups(members, [adminRole, modRole, defaultRole], [], "");
    expect(groups.map((g) => g.label)).toEqual(["Admin", "Moderator", "Members"]);
  });

  it("does not duplicate creator into Admin group when they already have an admin role", () => {
    const members: SpaceMember[] = [
      makeMember({ pubkey: "pk-creator", roles: [adminRole] }),
    ];
    const groups = buildRoleGroups(members, [adminRole, defaultRole], ["pk-creator"], "pk-creator");
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Admin");
    expect(groups[0].pubkeys).toEqual(["pk-creator"]);
  });
});
