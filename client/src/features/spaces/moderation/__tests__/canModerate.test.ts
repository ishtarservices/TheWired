/**
 * Tests for the role-hierarchy / admin-fallback logic that gates moderation
 * actions in MemberContextMenu. Logic is duplicated as a pure function here
 * to keep tests focused (the hook itself is tested via integration UX).
 */
import { describe, it, expect } from "vitest";
import type { Space, SpaceMember, SpaceRole } from "@/types/space";

function makeRole(overrides: Partial<SpaceRole> = {}): SpaceRole {
  return {
    id: "r",
    spaceId: "space-1",
    name: "Role",
    position: 100,
    isDefault: false,
    isAdmin: false,
    permissions: [],
    ...overrides,
  };
}

function makeSpace(overrides: Partial<Space> = {}): Space {
  return {
    id: "space-1",
    name: "Test",
    hostRelay: "wss://r",
    mode: "read-write",
    isPrivate: false,
    adminPubkeys: [],
    memberPubkeys: [],
    feedPubkeys: [],
    creatorPubkey: "",
    createdAt: 0,
    ...overrides,
  };
}

/** Mirror of the canModerate logic in MemberContextMenu.tsx — kept pure for testing. */
function canModerate(
  actorPubkey: string | null,
  targetPubkey: string,
  members: SpaceMember[],
  space: Space | undefined,
): boolean {
  if (!actorPubkey || actorPubkey === targetPubkey) return false;

  const actorIsAdminFallback =
    !!space &&
    (space.adminPubkeys.includes(actorPubkey) || space.creatorPubkey === actorPubkey);
  const targetIsAdminFallback =
    !!space &&
    (space.adminPubkeys.includes(targetPubkey) || space.creatorPubkey === targetPubkey);

  const actorMember = members.find((m) => m.pubkey === actorPubkey);
  const targetMember = members.find((m) => m.pubkey === targetPubkey);

  if (!actorMember?.roles.length) {
    if (!actorIsAdminFallback) return false;
    return !targetIsAdminFallback;
  }

  const actorBest = Math.min(...actorMember.roles.map((r) => r.position));
  const targetBest = targetMember?.roles.length
    ? Math.min(...targetMember.roles.map((r) => r.position))
    : Infinity;

  return actorBest < targetBest;
}

describe("canModerate (MemberContextMenu)", () => {
  const adminRole = makeRole({ id: "admin", name: "Admin", position: 1, isAdmin: true });
  const memberRole = makeRole({ id: "default", name: "Members", position: 100, isDefault: true });

  it("returns false when actor moderates themselves", () => {
    expect(canModerate("pk-a", "pk-a", [], makeSpace())).toBe(false);
  });

  it("returns false when actor pubkey is null", () => {
    expect(canModerate(null, "pk-a", [], makeSpace())).toBe(false);
  });

  it("admin role can moderate a regular member (strict outrank)", () => {
    const members: SpaceMember[] = [
      { pubkey: "pk-admin", roles: [adminRole], joinedAt: 0 },
      { pubkey: "pk-user", roles: [memberRole], joinedAt: 0 },
    ];
    expect(canModerate("pk-admin", "pk-user", members, makeSpace())).toBe(true);
  });

  it("regular member cannot moderate admin (cannot outrank)", () => {
    const members: SpaceMember[] = [
      { pubkey: "pk-admin", roles: [adminRole], joinedAt: 0 },
      { pubkey: "pk-user", roles: [memberRole], joinedAt: 0 },
    ];
    expect(canModerate("pk-user", "pk-admin", members, makeSpace())).toBe(false);
  });

  it("creator without explicit role row CAN moderate (fallback path)", () => {
    const members: SpaceMember[] = [
      { pubkey: "pk-user", roles: [memberRole], joinedAt: 0 },
    ];
    const space = makeSpace({ creatorPubkey: "pk-creator" });
    expect(canModerate("pk-creator", "pk-user", members, space)).toBe(true);
  });

  it("admin via adminPubkeys CAN moderate a regular member (fallback path)", () => {
    const members: SpaceMember[] = [
      { pubkey: "pk-user", roles: [memberRole], joinedAt: 0 },
    ];
    const space = makeSpace({ adminPubkeys: ["pk-fallback-admin"] });
    expect(canModerate("pk-fallback-admin", "pk-user", members, space)).toBe(true);
  });

  it("admin fallback CANNOT moderate another admin via fallback", () => {
    const space = makeSpace({ adminPubkeys: ["pk-admin-a", "pk-admin-b"] });
    expect(canModerate("pk-admin-a", "pk-admin-b", [], space)).toBe(false);
  });

  it("admin fallback CANNOT moderate the creator", () => {
    const space = makeSpace({ adminPubkeys: ["pk-admin"], creatorPubkey: "pk-creator" });
    expect(canModerate("pk-admin", "pk-creator", [], space)).toBe(false);
  });

  it("non-admin actor with no roles cannot moderate anyone (security: no path through fallback)", () => {
    expect(canModerate("pk-rando", "pk-user", [], makeSpace())).toBe(false);
  });

  it("members with equal role rank cannot moderate each other", () => {
    const peerRole = makeRole({ id: "mod", position: 50 });
    const members: SpaceMember[] = [
      { pubkey: "pk-mod-a", roles: [peerRole], joinedAt: 0 },
      { pubkey: "pk-mod-b", roles: [peerRole], joinedAt: 0 },
    ];
    expect(canModerate("pk-mod-a", "pk-mod-b", members, makeSpace())).toBe(false);
  });
});
