import { buildRoleGroups } from "../roleGroups";
import type { SpaceMemberRoles, SpaceRoleInfo } from "@/lib/api/spaces";

const role = (over: Partial<SpaceRoleInfo>): SpaceRoleInfo => ({
  id: "r",
  name: "Role",
  position: 0,
  color: null,
  isDefault: false,
  isAdmin: false,
  ...over,
});

const ADMIN = role({ id: "admin", name: "Admin", position: 0, color: "#f00", isAdmin: true });
const MOD = role({ id: "mod", name: "Mods", position: 1, color: "#0f0" });
const DEFAULT = role({ id: "member", name: "Members", position: 999, isDefault: true });
const ROLES = [ADMIN, MOD, DEFAULT];

const member = (pubkey: string, roles: SpaceRoleInfo[] = []): SpaceMemberRoles => ({
  pubkey,
  roles,
});

describe("buildRoleGroups", () => {
  it("groups by highest (lowest-position) role, sorted admins-first", () => {
    const groups = buildRoleGroups(
      [member("alice", [MOD, ADMIN]), member("bob", [MOD]), member("carol", [DEFAULT])],
      ROLES,
      null,
    );
    expect(groups.map((g) => g.label)).toEqual(["Admin", "Mods", "Members"]);
    expect(groups[0].pubkeys).toEqual(["alice"]);
    expect(groups[0].color).toBe("#f00");
    expect(groups[1].pubkeys).toEqual(["bob"]);
  });

  it("puts the creator without role rows into a synthetic admin group", () => {
    const groups = buildRoleGroups([member("creator"), member("someone")], ROLES, "creator");
    expect(groups[0].label).toBe("Admin");
    expect(groups[0].pubkeys).toEqual(["creator"]);
    expect(groups[1].label).toBe("Members");
    expect(groups[1].pubkeys).toEqual(["someone"]);
  });

  it("labels the default group Members when no default role exists", () => {
    const groups = buildRoleGroups([member("x")], [], null);
    expect(groups).toEqual([
      { roleId: "__default__", label: "Members", color: null, position: 999, pubkeys: ["x"] },
    ]);
  });
});
