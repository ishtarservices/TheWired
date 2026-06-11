/**
 * #105 — the permission hot path must issue a CONSTANT number of queries,
 * independent of how many roles a member holds (no N+1 fan-out).
 *
 * Behavior-preservation is covered by the existing permission/idor/voice suites;
 * this asserts the optimization itself by counting db.select calls for a member
 * with few vs many roles.
 *
 * Needs Postgres `thewired_test` (pnpm dev:infra).
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { db } from "../../src/db/connection.js";
import { spaces } from "../../src/db/schema/spaces.js";
import { spaceRoles, rolePermissions } from "../../src/db/schema/permissions.js";
import { spaceMembers, memberRoles } from "../../src/db/schema/members.js";
import { roleService } from "../../src/services/roleService.js";
import { permissionService } from "../../src/services/permissionService.js";
import { nanoid } from "../../src/lib/id.js";
import { LUNA } from "../helpers/testUsers.js";

async function makeSpaceWithMemberRoles(spaceId: string, member: string, roleCount: number) {
  await db.insert(spaces).values({ id: spaceId, name: spaceId, hostRelay: "wss://r", creatorPubkey: LUNA.pubkey, createdAt: Date.now() }).onConflictDoNothing();
  await db.insert(spaceMembers).values({ spaceId, pubkey: member }).onConflictDoNothing();
  for (let i = 0; i < roleCount; i++) {
    const roleId = nanoid(12);
    await db.insert(spaceRoles).values({ id: roleId, spaceId, name: `role-${i}`, position: i + 5, isDefault: false, isAdmin: false });
    await db.insert(rolePermissions).values({ roleId, permission: "SEND_MESSAGES" });
    await db.insert(memberRoles).values({ spaceId, pubkey: member, roleId }).onConflictDoNothing();
  }
}

/** Count db.select() calls made by `fn`. */
async function countSelects(fn: () => Promise<unknown>): Promise<number> {
  const spy = vi.spyOn(db, "select");
  const before = spy.mock.calls.length;
  await fn();
  const n = spy.mock.calls.length - before;
  spy.mockRestore();
  return n;
}

const MEMBER = "c".repeat(64);

beforeAll(async () => {
  const { runMigrations } = await import("../../src/db/migrate.js");
  await runMigrations();
});

describe("#105 — permission queries are constant in role count", () => {
  it("getEffectivePermissions does not scale with the number of roles", async () => {
    await makeSpaceWithMemberRoles("perf-2", MEMBER, 2);
    await makeSpaceWithMemberRoles("perf-8", MEMBER, 8);

    const few = await countSelects(() => roleService.getEffectivePermissions("perf-2", MEMBER));
    const many = await countSelects(() => roleService.getEffectivePermissions("perf-8", MEMBER));

    expect(many).toBe(few); // constant — no per-role fan-out
    expect(many).toBeLessThanOrEqual(4);
  });

  it("permissionService.check does not scale with the number of roles", async () => {
    const few = await countSelects(() => permissionService.check("perf-2", MEMBER, "SEND_MESSAGES"));
    const many = await countSelects(() => permissionService.check("perf-8", MEMBER, "SEND_MESSAGES"));

    expect(many).toBe(few);
    expect(many).toBeLessThanOrEqual(7);
  });

  it("still returns correct permissions after batching", async () => {
    await makeSpaceWithMemberRoles("perf-8", MEMBER, 8);
    const perms = await roleService.getEffectivePermissions("perf-8", MEMBER);
    expect(perms).toContain("SEND_MESSAGES");
    const check = await permissionService.check("perf-8", MEMBER, "SEND_MESSAGES");
    expect(check.allowed).toBe(true);
  });
});
