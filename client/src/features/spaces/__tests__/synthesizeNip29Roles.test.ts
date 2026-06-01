import { describe, it, expect } from "vitest";
import {
  NIP29_ADMIN_ROLE_ID,
  NIP29_MEMBER_ROLE_ID,
  nip29MyPermissions,
  synthesizeNip29Members,
  synthesizeNip29Roles,
} from "../synthesizeNip29Roles";

describe("synthesizeNip29Roles", () => {
  it("produces an admin role and a default member role", () => {
    const roles = synthesizeNip29Roles("g1");
    expect(roles).toHaveLength(2);
    const admin = roles.find((r) => r.isAdmin);
    const member = roles.find((r) => r.isDefault);
    expect(admin?.id).toBe(NIP29_ADMIN_ROLE_ID);
    expect(admin?.permissions).toContain("MANAGE_SPACE");
    expect(member?.id).toBe(NIP29_MEMBER_ROLE_ID);
    expect(member?.permissions).toContain("SEND_MESSAGES");
    expect(member?.permissions).not.toContain("MANAGE_SPACE");
  });
});

describe("synthesizeNip29Members", () => {
  it("assigns admin role to admins and member role to others", () => {
    const members = synthesizeNip29Members("g1", ["alice", "bob"], ["alice"]);
    const alice = members.find((m) => m.pubkey === "alice");
    const bob = members.find((m) => m.pubkey === "bob");
    expect(alice?.roles[0].isAdmin).toBe(true);
    expect(bob?.roles[0].isDefault).toBe(true);
  });

  it("includes admins even when 39002 omits them", () => {
    const members = synthesizeNip29Members("g1", ["bob"], ["alice"]);
    expect(members.map((m) => m.pubkey).sort()).toEqual(["alice", "bob"]);
    expect(members.find((m) => m.pubkey === "alice")?.roles[0].isAdmin).toBe(true);
  });

  it("dedupes a pubkey present in both sets", () => {
    const members = synthesizeNip29Members("g1", ["alice"], ["alice"]);
    expect(members).toHaveLength(1);
    expect(members[0].roles[0].isAdmin).toBe(true);
  });
});

describe("nip29MyPermissions", () => {
  it("grants admin permissions to an admin pubkey", () => {
    expect(nip29MyPermissions("alice", ["alice"])).toContain("MANAGE_SPACE");
  });

  it("grants only member permissions to a non-admin", () => {
    const perms = nip29MyPermissions("bob", ["alice"]);
    expect(perms).toContain("SEND_MESSAGES");
    expect(perms).not.toContain("MANAGE_SPACE");
  });

  it("treats a null pubkey as a member", () => {
    expect(nip29MyPermissions(null, ["alice"])).not.toContain("MANAGE_SPACE");
  });
});
