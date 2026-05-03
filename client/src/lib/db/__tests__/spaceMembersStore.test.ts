import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import {
  saveMembers,
  loadMembers,
  loadAllMembers,
  removeMembers,
} from "../spaceMembersStore";
import { setActivePubkey } from "../userStateStore";
import { getDB } from "../database";
import type { SpaceMember, SpaceRole } from "@/types/space";

function makeRole(overrides: Partial<SpaceRole> = {}): SpaceRole {
  return {
    id: "role-default",
    spaceId: "space-1",
    name: "Member",
    position: 100,
    color: undefined,
    isDefault: true,
    isAdmin: false,
    permissions: [],
    ...overrides,
  };
}

function makeMember(overrides: Partial<SpaceMember> = {}): SpaceMember {
  return {
    pubkey: "pk-1",
    roles: [],
    joinedAt: 1_000_000,
    ...overrides,
  };
}

beforeEach(async () => {
  const db = await getDB();
  await db.clear("user_state");
  setActivePubkey(null);
});

describe("spaceMembersStore", () => {
  it("returns undefined when no members saved for a space", async () => {
    const members = await loadMembers("missing");
    expect(members).toBeUndefined();
  });

  it("saves and loads members per space", async () => {
    const members = [
      makeMember({ pubkey: "pk-a", roles: [makeRole({ id: "admin", name: "Admin", position: 1 })] }),
      makeMember({ pubkey: "pk-b" }),
    ];
    await saveMembers("space-1", members);
    const loaded = await loadMembers("space-1");
    expect(loaded).toHaveLength(2);
    expect(loaded?.[0].pubkey).toBe("pk-a");
    expect(loaded?.[0].roles[0].name).toBe("Admin");
  });

  it("isolates members by spaceId", async () => {
    await saveMembers("space-1", [makeMember({ pubkey: "pk-a" })]);
    await saveMembers("space-2", [makeMember({ pubkey: "pk-b" })]);
    expect((await loadMembers("space-1"))?.[0].pubkey).toBe("pk-a");
    expect((await loadMembers("space-2"))?.[0].pubkey).toBe("pk-b");
  });

  it("overwrites members when saved again (write-through semantics)", async () => {
    await saveMembers("space-1", [makeMember({ pubkey: "pk-a" }), makeMember({ pubkey: "pk-b" })]);
    await saveMembers("space-1", [makeMember({ pubkey: "pk-a" })]); // pk-b kicked
    const loaded = await loadMembers("space-1");
    expect(loaded).toHaveLength(1);
    expect(loaded?.[0].pubkey).toBe("pk-a");
  });

  it("loadAllMembers returns map of every saved space", async () => {
    await saveMembers("space-1", [makeMember({ pubkey: "pk-a" })]);
    await saveMembers("space-2", [makeMember({ pubkey: "pk-b" })]);
    const all = await loadAllMembers();
    expect(all.size).toBe(2);
    expect(all.get("space-1")?.[0].pubkey).toBe("pk-a");
    expect(all.get("space-2")?.[0].pubkey).toBe("pk-b");
  });

  it("removeMembers deletes a single space's roster", async () => {
    await saveMembers("space-1", [makeMember({ pubkey: "pk-a" })]);
    await saveMembers("space-2", [makeMember({ pubkey: "pk-b" })]);
    await removeMembers("space-1");
    expect(await loadMembers("space-1")).toBeUndefined();
    expect(await loadMembers("space-2")).toBeDefined();
  });

  it("scopes per active pubkey (multi-account isolation)", async () => {
    setActivePubkey("alice");
    await saveMembers("space-1", [makeMember({ pubkey: "pk-alice" })]);

    setActivePubkey("bob");
    expect(await loadMembers("space-1")).toBeUndefined();
    await saveMembers("space-1", [makeMember({ pubkey: "pk-bob" })]);

    setActivePubkey("alice");
    expect((await loadMembers("space-1"))?.[0].pubkey).toBe("pk-alice");
  });
});
