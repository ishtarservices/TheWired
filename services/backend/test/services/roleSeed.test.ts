/**
 * Feature tests for the role-seeding fixes.
 *  - #61: seeding is atomic (Admin + default Member always seeded together).
 *  - #0 guard: seedDefaultRoles refuses to grant Admin to a non-creator.
 *
 * Needs Postgres `thewired_test` (pnpm dev:infra). Harness TRUNCATEs app.* per test.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { db } from "../../src/db/connection.js";
import { spaces } from "../../src/db/schema/spaces.js";
import { roleService } from "../../src/services/roleService.js";
import { LUNA, MARCUS } from "../helpers/testUsers.js";

async function makeSpace(id: string, creator: string | null) {
  await db.insert(spaces).values({
    id, name: id, hostRelay: "wss://r.test", creatorPubkey: creator, createdAt: Date.now(),
  }).onConflictDoNothing();
}

beforeAll(async () => {
  const { runMigrations } = await import("../../src/db/migrate.js");
  await runMigrations();
});

describe("roleService seeding", () => {
  it("#61 seeds Admin + default Member atomically with full member permissions", async () => {
    await makeSpace("seed-space", LUNA.pubkey);
    await roleService.seedDefaultRoles("seed-space", LUNA.pubkey);

    const roles = await roleService.listRoles("seed-space");
    const admin = roles.find((r) => r.isAdmin);
    const member = roles.find((r) => r.isDefault);
    expect(admin).toBeTruthy();
    expect(member).toBeTruthy();
    expect(member!.isAdmin).toBe(false);
    // default member perms present
    expect(member!.permissions).toContain("SEND_MESSAGES");
    expect(member!.permissions).toContain("CONNECT");
    // creator is assigned the Admin role
    const lunaRoles = await roleService.getMemberRoles("seed-space", LUNA.pubkey);
    expect(lunaRoles.some((r) => r.isAdmin)).toBe(true);
  });

  it("#0 guard: seedDefaultRoles does not grant Admin to a non-creator", async () => {
    await makeSpace("seed-guard", LUNA.pubkey);
    // first, legitimate seed by the creator
    await roleService.seedDefaultRoles("seed-guard", LUNA.pubkey);
    // attacker tries to seed (and thereby self-assign Admin)
    await roleService.seedDefaultRoles("seed-guard", MARCUS.pubkey);

    const marcusRoles = await roleService.getMemberRoles("seed-guard", MARCUS.pubkey);
    expect(marcusRoles.some((r) => r.isAdmin)).toBe(false);
  });
});
