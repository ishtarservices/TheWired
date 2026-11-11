/**
 * Channel subfolders (categories): the layout document, legacy compatibility,
 * the 0039 backfill, and category permission templates. Contract:
 * docs/CHANNEL_LAYOUT.md.
 *
 * NOTE: the harness TRUNCATEs app.* before every `it`, so each test builds
 * its own spaces. Needs Postgres (pnpm dev:infra).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { eq, and, sql } from "drizzle-orm";
import postgres from "postgres";
import { buildTestServer, closeTestServer } from "../helpers/testServer.js";
import { LUNA, MARCUS, ZARA, DECKARD, type TestUser } from "../helpers/testUsers.js";
import { db } from "../../src/db/connection.js";
import { spaceChannels, spaceChannelCategories } from "../../src/db/schema/channels.js";
import { spaceMembers, memberRoles } from "../../src/db/schema/members.js";
import { spaceRoles, rolePermissions, channelOverrides, categoryOverrides } from "../../src/db/schema/permissions.js";
import { permissionService } from "../../src/services/permissionService.js";
import { deriveCategoryId } from "../../src/services/channelLayoutService.js";

let server: FastifyInstance;

const SPACE = "layout-space";
const OTHER = "layout-other";

type Channel = { id: string; label: string; type: string; categoryId: string | null; position: number; permissionsSynced: boolean; isDefault: boolean };
type Category = { id: string; name: string; position: number };
type Layout = { revision: number; categories: Category[]; channels: Channel[] };

const as = (u: TestUser) => ({ "x-auth-pubkey": u.pubkey });

beforeAll(async () => {
  server = await buildTestServer();
});

afterAll(async () => {
  await closeTestServer();
});

async function createSpace(user: TestUser, id = SPACE, channels?: Array<{ type: string; label: string }>) {
  const res = await server.inject({
    method: "POST",
    url: "/spaces",
    headers: as(user),
    payload: {
      id,
      name: `Space ${id}`,
      hostRelay: "wss://relay.test.com",
      mode: "read-write",
      channels: channels ?? [
        { type: "chat", label: "#general" },
        { type: "chat", label: "#random" },
        { type: "voice", label: "#lounge" },
        { type: "notes", label: "#notes" },
      ],
    },
  });
  expect(res.statusCode).toBe(200);
}

async function getLayout(spaceId = SPACE): Promise<Layout> {
  const res = await server.inject({ method: "GET", url: `/spaces/${spaceId}/channels/layout` });
  expect(res.statusCode).toBe(200);
  return res.json().data;
}

async function listChannels(spaceId = SPACE): Promise<Channel[]> {
  const res = await server.inject({ method: "GET", url: `/spaces/${spaceId}/channels` });
  expect(res.statusCode).toBe(200);
  return res.json().data;
}

const byLabel = (layout: Layout | Channel[], label: string) =>
  (Array.isArray(layout) ? layout : layout.channels).find((c) => c.label === label)!;

function putLayout(user: TestUser | null, body: unknown, spaceId = SPACE) {
  return server.inject({
    method: "PUT",
    url: `/spaces/${spaceId}/channels/layout`,
    headers: user ? as(user) : {},
    payload: body as Record<string, unknown>,
  });
}

/** Turn a label-based description into a layout PUT body against the current layout. */
async function docFor(
  spec: { uncategorized: string[]; categories: Array<{ id?: string; name: string; labels: string[] }> },
  spaceId = SPACE,
) {
  const layout = await getLayout(spaceId);
  const id = (label: string) => byLabel(layout, label).id;
  return {
    baseRevision: layout.revision,
    uncategorized: spec.uncategorized.map(id),
    categories: spec.categories.map((c) => ({ id: c.id, name: c.name, channelIds: c.labels.map(id) })),
  };
}

async function createChannel(user: TestUser, payload: Record<string, unknown>, spaceId = SPACE) {
  return server.inject({ method: "POST", url: `/spaces/${spaceId}/channels`, headers: as(user), payload });
}

async function roleByName(spaceId: string, name: string) {
  const [role] = await db
    .select()
    .from(spaceRoles)
    .where(and(eq(spaceRoles.spaceId, spaceId), eq(spaceRoles.name, name)));
  return role;
}

/** Insert a role at an exact hierarchy position with exact permissions. */
async function addRole(spaceId: string, name: string, position: number, permissions: string[]) {
  const id = `${spaceId}-${name}`.toLowerCase();
  await db.insert(spaceRoles).values({ id, spaceId, name, position, isDefault: false, isAdmin: false });
  if (permissions.length > 0) {
    await db.insert(rolePermissions).values(permissions.map((permission) => ({ roleId: id, permission })));
  }
  return id;
}

async function addMember(spaceId: string, user: TestUser, roleIds: string[]) {
  await db.insert(spaceMembers).values({ spaceId, pubkey: user.pubkey }).onConflictDoNothing();
  for (const roleId of roleIds) {
    await db.insert(memberRoles).values({ spaceId, pubkey: user.pubkey, roleId }).onConflictDoNothing();
  }
}

/** Positions are dense 0..n-1 and in canonical order (uncategorized, then categories in order). */
function expectCanonical(layout: Layout) {
  const positions = layout.channels.map((c) => c.position);
  expect(positions).toEqual(positions.map((_, i) => i));
  const catOrder = new Map(layout.categories.map((c) => [c.id, c.position]));
  const groupKey = (c: Channel) => (c.categoryId === null ? -1 : catOrder.get(c.categoryId)!);
  for (let i = 1; i < layout.channels.length; i++) {
    expect(groupKey(layout.channels[i])).toBeGreaterThanOrEqual(groupKey(layout.channels[i - 1]));
  }
  expect(layout.categories.map((c) => c.position)).toEqual(layout.categories.map((_, i) => i));
}

async function channelOverrideRows(channelId: string) {
  return db.select().from(channelOverrides).where(eq(channelOverrides.channelId, channelId));
}

// ── GET ─────────────────────────────────────────────────────────────────

describe("GET /:spaceId/channels/layout", () => {
  it("returns revision 0, no categories and the seeded channels for a new space", async () => {
    await createSpace(LUNA);
    const layout = await getLayout();
    expect(layout.revision).toBe(0);
    expect(layout.categories).toEqual([]);
    expect(layout.channels.map((c) => c.label)).toEqual(["#general", "#random", "#lounge", "#notes"]);
    expect(layout.channels.every((c) => c.categoryId === null)).toBe(true);
  });

  it("404s for an unknown space", async () => {
    const res = await server.inject({ method: "GET", url: `/spaces/nope/channels/layout` });
    expect(res.statusCode).toBe(404);
  });
});

// ── PUT ─────────────────────────────────────────────────────────────────

describe("PUT /:spaceId/channels/layout", () => {
  it("requires auth and MANAGE_CHANNELS", async () => {
    await createSpace(LUNA);
    const body = await docFor({ uncategorized: ["#general", "#random", "#lounge", "#notes"], categories: [] });
    expect((await putLayout(null, body)).statusCode).toBe(401);
    // Not a member at all.
    expect((await putLayout(MARCUS, body)).statusCode).toBe(403);
    // A plain member.
    const member = await roleByName(SPACE, "Member");
    await addMember(SPACE, MARCUS, [member.id]);
    expect((await putLayout(MARCUS, body)).statusCode).toBe(403);
    expect((await getLayout()).revision).toBe(0);
  });

  it("creates categories, moves channels and renumbers canonically (old clients see the same order)", async () => {
    await createSpace(LUNA);
    const body = await docFor({
      uncategorized: ["#notes"],
      categories: [
        { name: "Text", labels: ["#random", "#general"] },
        { name: "Voice", labels: ["#lounge"] },
      ],
    });
    const res = await putLayout(LUNA, body);
    expect(res.statusCode).toBe(200);
    const layout: Layout = res.json().data;
    expect(layout.revision).toBe(1);
    expect(layout.categories.map((c) => [c.id, c.name])).toEqual([["Text", "Text"], ["Voice", "Voice"]]);
    expect(layout.channels.map((c) => c.label)).toEqual(["#notes", "#random", "#general", "#lounge"]);
    expectCanonical(layout);
    // GET /channels (what older clients read) is position-sorted the same way.
    expect((await listChannels()).map((c) => c.label)).toEqual(["#notes", "#random", "#general", "#lounge"]);
    expect(byLabel(layout, "#general").categoryId).toBe("Text");
  });

  it("renames without changing the id, reorders, and deletes (its channels re-homed)", async () => {
    await createSpace(LUNA);
    await putLayout(LUNA, await docFor({
      uncategorized: [],
      categories: [
        { name: "Text", labels: ["#general", "#random"] },
        { name: "Voice", labels: ["#lounge"] },
        { name: "Feeds", labels: ["#notes"] },
      ],
    }));
    const res = await putLayout(LUNA, await docFor({
      uncategorized: ["#notes"],
      categories: [
        { id: "Voice", name: "Hangout", labels: ["#lounge"] },
        { id: "Text", name: "Talk", labels: ["#general", "#random"] },
      ],
    }));
    expect(res.statusCode).toBe(200);
    const layout: Layout = res.json().data;
    expect(layout.categories.map((c) => [c.id, c.name])).toEqual([["Voice", "Hangout"], ["Text", "Talk"]]);
    expect(byLabel(layout, "#notes").categoryId).toBeNull();
    expectCanonical(layout);
    const rows = await db.select().from(spaceChannelCategories).where(eq(spaceChannelCategories.spaceId, SPACE));
    expect(rows.map((r) => r.id).sort()).toEqual(["Text", "Voice"]);
  });

  it("swaps two names in one write (case-insensitive unique index)", async () => {
    await createSpace(LUNA);
    await putLayout(LUNA, await docFor({
      uncategorized: ["#notes", "#lounge"],
      categories: [{ name: "A", labels: ["#general"] }, { name: "B", labels: ["#random"] }],
    }));
    const res = await putLayout(LUNA, await docFor({
      uncategorized: ["#notes", "#lounge"],
      categories: [{ id: "A", name: "b", labels: ["#general"] }, { id: "B", name: "a", labels: ["#random"] }],
    }));
    expect(res.statusCode).toBe(200);
    expect(res.json().data.categories.map((c: Category) => [c.id, c.name])).toEqual([["A", "b"], ["B", "a"]]);
  });

  it("keeps empty categories", async () => {
    await createSpace(LUNA);
    const res = await putLayout(LUNA, await docFor({
      uncategorized: ["#general", "#random", "#lounge", "#notes"],
      categories: [{ name: "Later", labels: [] }],
    }));
    expect(res.statusCode).toBe(200);
    expect((await getLayout()).categories.map((c) => c.name)).toEqual(["Later"]);
  });

  it("409s on a stale revision and leaves the layout alone", async () => {
    await createSpace(LUNA);
    const stale = await docFor({ uncategorized: ["#general", "#random", "#lounge", "#notes"], categories: [{ name: "X", labels: [] }] });
    // Someone else changes the layout first.
    expect((await createChannel(LUNA, { type: "chat", label: "#new" })).statusCode).toBe(200);
    const res = await putLayout(LUNA, stale);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("LAYOUT_STALE");
    expect((await getLayout()).categories).toEqual([]);
  });

  it("requires every channel exactly once", async () => {
    await createSpace(LUNA);
    const layout = await getLayout();
    const ids = layout.channels.map((c) => c.id);
    const base = { baseRevision: layout.revision, categories: [] };
    // Missing one → stale (409), so a client refetches.
    expect((await putLayout(LUNA, { ...base, uncategorized: ids.slice(1) })).statusCode).toBe(409);
    // An unknown id → 409.
    expect((await putLayout(LUNA, { ...base, uncategorized: [...ids, "ghost"] })).statusCode).toBe(409);
    // A duplicate → 400.
    expect((await putLayout(LUNA, { ...base, uncategorized: [...ids, ids[0]] })).statusCode).toBe(400);
    expect(
      (await putLayout(LUNA, { ...base, uncategorized: ids.slice(1), categories: [{ name: "A", channelIds: [ids[0], ids[0]] }] })).statusCode,
    ).toBe(400);
    expect((await getLayout()).revision).toBe(0);
  });

  it("validates names: trimmed, unique ignoring case, no control/invisible characters, bounded", async () => {
    await createSpace(LUNA);
    const ids = (await getLayout()).channels.map((c) => c.id);
    const put = (categories: Array<{ id?: string; name: string; channelIds: string[] }>) =>
      putLayout(LUNA, { baseRevision: 0, uncategorized: ids, categories });

    const dup = await put([{ name: "Dev", channelIds: [] }, { name: " dev ", channelIds: [] }]);
    expect(dup.statusCode).toBe(400);
    expect(dup.json().code).toBe("DUPLICATE_NAME");
    expect((await put([{ name: "   ", channelIds: [] }])).statusCode).toBe(400);
    expect((await put([{ name: "x".repeat(129), channelIds: [] }])).statusCode).toBe(400);
    const rlo = String.fromCharCode(0x202e);
    const zwsp = String.fromCharCode(0x200b);
    const nul = String.fromCharCode(0);
    expect((await put([{ name: `evil${rlo}txt`, channelIds: [] }])).statusCode).toBe(400);
    expect((await put([{ name: `a${zwsp}b`, channelIds: [] }])).statusCode).toBe(400);
    expect((await put([{ name: `a${nul}b`, channelIds: [] }])).statusCode).toBe(400);
    expect((await put(Array.from({ length: 51 }, (_, i) => ({ name: `c${i}`, channelIds: [] })))).statusCode).toBe(400);

    const ok = await put([{ name: "  Spaced  ", channelIds: [] }]);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.categories[0].name).toBe("Spaced");
  });

  it("rejects unknown or repeated category ids", async () => {
    await createSpace(LUNA);
    const ids = (await getLayout()).channels.map((c) => c.id);
    expect((await putLayout(LUNA, { baseRevision: 0, uncategorized: ids, categories: [{ id: "invented", name: "X", channelIds: [] }] })).statusCode).toBe(400);
    await putLayout(LUNA, { baseRevision: 0, uncategorized: ids, categories: [{ name: "X", channelIds: [] }] });
    expect(
      (await putLayout(LUNA, {
        baseRevision: 1,
        uncategorized: ids,
        categories: [{ id: "X", name: "X", channelIds: [] }, { id: "X", name: "Y", channelIds: [] }],
      })).statusCode,
    ).toBe(400);
  });

  it("cannot touch another space's channels or categories (IDOR)", async () => {
    await createSpace(LUNA, SPACE);
    await createSpace(MARCUS, OTHER);
    await putLayout(MARCUS, await docFor({ uncategorized: ["#general", "#random", "#lounge", "#notes"], categories: [{ name: "Theirs", labels: [] }] }, OTHER), OTHER);
    const otherBefore = await getLayout(OTHER);

    const mine = await getLayout(SPACE);
    const theirs = otherBefore.channels.map((c) => c.id);
    // Their channel ids in my layout → 409, nothing moves.
    expect((await putLayout(LUNA, { baseRevision: mine.revision, uncategorized: theirs, categories: [] })).statusCode).toBe(409);
    // Their category id in my layout → 400.
    expect(
      (await putLayout(LUNA, {
        baseRevision: mine.revision,
        uncategorized: mine.channels.map((c) => c.id),
        categories: [{ id: "Theirs", name: "Theirs", channelIds: [] }],
      })).statusCode,
    ).toBe(400);
    // Writing their layout without permission → 403.
    expect((await putLayout(LUNA, { baseRevision: otherBefore.revision, uncategorized: theirs, categories: [] }, OTHER)).statusCode).toBe(403);
    expect(await getLayout(OTHER)).toEqual(otherBefore);
  });

  it("bounds the body", async () => {
    await createSpace(LUNA);
    const res = await putLayout(LUNA, { baseRevision: 0, uncategorized: Array.from({ length: 501 }, (_, i) => `c${i}`), categories: [] });
    expect(res.statusCode).toBe(400);
    expect((await putLayout(LUNA, { baseRevision: -1, uncategorized: [], categories: [] })).statusCode).toBe(400);
    expect((await putLayout(LUNA, { baseRevision: "0", uncategorized: [], categories: [] })).statusCode).toBe(400);
    expect((await putLayout(LUNA, { baseRevision: 0, uncategorized: [""], categories: [] })).statusCode).toBe(400);
    expect((await putLayout(LUNA, { baseRevision: 0, uncategorized: [], categories: [{ id: "x".repeat(129), name: "a", channelIds: [] }] })).statusCode).toBe(400);
  });
});

// ── Ids ─────────────────────────────────────────────────────────────────

describe("category ids", () => {
  it("derive from the name when safe, suffix on collision, random otherwise", () => {
    expect(deriveCategoryId("Dev", new Set())).toBe("Dev");
    expect(deriveCategoryId("Dev", new Set(["Dev"]))).toBe("Dev~2");
    expect(deriveCategoryId("Dev", new Set(["Dev", "Dev~2"]))).toBe("Dev~3");
    for (const unsafe of ["a/b", "..", ".", "50%", "q?x", "a#b", "back\\slash", "y".repeat(65)]) {
      const id = deriveCategoryId(unsafe, new Set());
      expect(id).not.toBe(unsafe);
      expect(id).toMatch(/^[A-Za-z0-9_-]{12}$/);
    }
  });

  it("never reuse an id still in the space after a rename", async () => {
    await createSpace(LUNA);
    const ids = (await getLayout()).channels.map((c) => c.id);
    await putLayout(LUNA, { baseRevision: 0, uncategorized: ids, categories: [{ name: "Dev", channelIds: [] }] });
    await putLayout(LUNA, { baseRevision: 1, uncategorized: ids, categories: [{ id: "Dev", name: "Engineering", channelIds: [] }] });
    const res = await putLayout(LUNA, {
      baseRevision: 2,
      uncategorized: ids,
      categories: [{ id: "Dev", name: "Engineering", channelIds: [] }, { name: "Dev", channelIds: [] }],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.categories.map((c: Category) => [c.id, c.name])).toEqual([["Dev", "Engineering"], ["Dev~2", "Dev"]]);
  });
});

// ── Legacy channel endpoints ────────────────────────────────────────────

describe("legacy channel endpoints keep working", () => {
  it("create with a category NAME reuses the existing one ignoring case and whitespace", async () => {
    await createSpace(LUNA);
    const a = await createChannel(LUNA, { type: "chat", label: "#a", categoryId: "Dev" });
    const b = await createChannel(LUNA, { type: "chat", label: "#b", categoryId: " dev " });
    const c = await createChannel(LUNA, { type: "chat", label: "#c", categoryId: "DEV" });
    const d = await createChannel(LUNA, { type: "chat", label: "#d", categoryId: "Dev" }); // by id
    for (const r of [a, b, c, d]) expect(r.statusCode).toBe(200);
    const layout = await getLayout();
    expect(layout.categories.map((x) => [x.id, x.name])).toEqual([["Dev", "Dev"]]);
    for (const label of ["#a", "#b", "#c", "#d"]) expect(byLabel(layout, label).categoryId).toBe("Dev");
    expect(layout.channels.map((x) => x.label)).toEqual(["#general", "#random", "#lounge", "#notes", "#a", "#b", "#c", "#d"]);
    expectCanonical(layout);
  });

  it("create without a category appends to the uncategorized block, before categories", async () => {
    await createSpace(LUNA);
    await createChannel(LUNA, { type: "chat", label: "#in-dev", categoryId: "Dev" });
    await createChannel(LUNA, { type: "chat", label: "#loose" });
    await createChannel(LUNA, { type: "chat", label: "#blank", categoryId: "" });
    const layout = await getLayout();
    expect(layout.channels.map((x) => x.label)).toEqual(["#general", "#random", "#lounge", "#notes", "#loose", "#blank", "#in-dev"]);
    expect(byLabel(layout, "#blank").categoryId).toBeNull();
    expectCanonical(layout);
  });

  it("create accepts `temporary`, rejects a bad category name, and 409s a duplicate label", async () => {
    await createSpace(LUNA);
    const temp = await createChannel(LUNA, { type: "voice", label: "#pop-up", temporary: true });
    expect(temp.statusCode).toBe(200);
    expect(temp.json().data.temporary).toBe(true);
    const ctrl = String.fromCharCode(7);
    expect((await createChannel(LUNA, { type: "chat", label: "#x", categoryId: `bad${ctrl}` })).statusCode).toBe(400);
    expect((await createChannel(LUNA, { type: "chat", label: "#general" })).statusCode).toBe(409);
    // The one-per-space feed rule still holds.
    expect((await createChannel(LUNA, { type: "notes", label: "#more-notes" })).statusCode).toBe(400);
  });

  it("PATCH categoryId moves to the end of the target group; null moves out", async () => {
    await createSpace(LUNA);
    await createChannel(LUNA, { type: "chat", label: "#a", categoryId: "Dev" });
    const general = byLabel(await getLayout(), "#general");
    const res = await server.inject({
      method: "PATCH",
      url: `/spaces/${SPACE}/channels/${general.id}`,
      headers: as(LUNA),
      payload: { categoryId: "dev" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.categoryId).toBe("Dev");
    let layout = await getLayout();
    expect(layout.channels.map((x) => x.label)).toEqual(["#random", "#lounge", "#notes", "#a", "#general"]);
    expectCanonical(layout);

    await server.inject({
      method: "PATCH",
      url: `/spaces/${SPACE}/channels/${general.id}`,
      headers: as(LUNA),
      payload: { categoryId: null },
    });
    layout = await getLayout();
    expect(layout.channels.map((x) => x.label)).toEqual(["#random", "#lounge", "#notes", "#general", "#a"]);
    expect(byLabel(layout, "#general").categoryId).toBeNull();
    expectCanonical(layout);
  });

  it("PATCH position is an index within the channel's own group", async () => {
    await createSpace(LUNA);
    for (const label of ["#a", "#b", "#c"]) await createChannel(LUNA, { type: "chat", label, categoryId: "Dev" });
    const c = byLabel(await getLayout(), "#c");
    await server.inject({
      method: "PATCH",
      url: `/spaces/${SPACE}/channels/${c.id}`,
      headers: as(LUNA),
      payload: { position: 0 },
    });
    const layout = await getLayout();
    expect(layout.channels.map((x) => x.label)).toEqual(["#general", "#random", "#lounge", "#notes", "#c", "#a", "#b"]);
    expectCanonical(layout);
  });

  it("legacy POST /reorder is normalized into the canonical grouping", async () => {
    await createSpace(LUNA);
    await createChannel(LUNA, { type: "chat", label: "#a", categoryId: "Dev" });
    const layout = await getLayout();
    const order = ["#a", "#notes", "#lounge", "#random", "#general"].map((l) => byLabel(layout, l).id);
    const res = await server.inject({
      method: "POST",
      url: `/spaces/${SPACE}/channels/reorder`,
      headers: as(LUNA),
      payload: { orderedIds: order },
    });
    expect(res.statusCode).toBe(200);
    const after = await getLayout();
    // #a stays inside Dev (after every uncategorized channel); the rest follow the request.
    expect(after.channels.map((x) => x.label)).toEqual(["#notes", "#lounge", "#random", "#general", "#a"]);
    expectCanonical(after);
  });

  it("every write bumps the revision", async () => {
    await createSpace(LUNA);
    const r0 = (await getLayout()).revision;
    const created = await createChannel(LUNA, { type: "chat", label: "#a" });
    const id = created.json().data.id;
    expect((await getLayout()).revision).toBe(r0 + 1);
    await server.inject({ method: "PATCH", url: `/spaces/${SPACE}/channels/${id}`, headers: as(LUNA), payload: { label: "#b" } });
    expect((await getLayout()).revision).toBe(r0 + 2);
    await server.inject({ method: "POST", url: `/spaces/${SPACE}/channels/reorder`, headers: as(LUNA), payload: { orderedIds: [id] } });
    expect((await getLayout()).revision).toBe(r0 + 3);
    await server.inject({ method: "DELETE", url: `/spaces/${SPACE}/channels/${id}`, headers: as(LUNA) });
    expect((await getLayout()).revision).toBe(r0 + 4);
  });

  it("deleting a channel deletes its overrides", async () => {
    await createSpace(LUNA);
    const ch = byLabel(await getLayout(), "#random");
    const member = await roleByName(SPACE, "Member");
    await db.insert(channelOverrides).values({ roleId: member.id, channelId: ch.id, permission: "SEND_MESSAGES", effect: "deny" });
    const res = await server.inject({ method: "DELETE", url: `/spaces/${SPACE}/channels/${ch.id}`, headers: as(LUNA) });
    expect(res.statusCode).toBe(200);
    expect(await channelOverrideRows(ch.id)).toEqual([]);
  });

  it("my-spaces and join hydrate categories + revision", async () => {
    await createSpace(LUNA);
    await createChannel(LUNA, { type: "chat", label: "#a", categoryId: "Dev" });
    const mine = await server.inject({ method: "GET", url: "/spaces/my-spaces", headers: as(LUNA) });
    expect(mine.statusCode).toBe(200);
    const entry = mine.json().data.find((e: { space: { id: string } }) => e.space.id === SPACE);
    expect(entry.categories.map((c: Category) => c.id)).toEqual(["Dev"]);
    expect(entry.layoutRevision).toBe(1);
  });

  it("concurrent creates and layout writes keep positions dense and canonical", async () => {
    await createSpace(LUNA);
    const results = await Promise.all([
      ...Array.from({ length: 6 }, (_, i) => createChannel(LUNA, { type: "chat", label: `#c${i}`, categoryId: i % 2 ? "Odd" : undefined })),
      docFor({ uncategorized: ["#notes", "#lounge", "#random", "#general"], categories: [] }).then((b) => putLayout(LUNA, b)),
    ]);
    for (const r of results) expect([200, 409]).toContain(r.statusCode);
    const layout = await getLayout();
    expect(layout.channels).toHaveLength(10);
    expectCanonical(layout);
  });
});

// ── Backfill (0039) ─────────────────────────────────────────────────────

describe("0039 backfill", () => {
  async function runMigration0039() {
    const file = join(dirname(fileURLToPath(import.meta.url)), "../../src/db/migrations/0039_channel_categories.sql");
    const client = postgres(process.env.DATABASE_URL!, { onnotice: () => {} });
    try {
      await client.unsafe(await readFile(file, "utf-8"));
    } finally {
      await client.end();
    }
  }

  it("merges case/whitespace variants, keeps ids readable, renumbers, drops orphan overrides; idempotent", async () => {
    await createSpace(LUNA, SPACE, [{ type: "chat", label: "#general" }]);
    const member = await roleByName(SPACE, "Member");
    // Simulate the pre-0039 state: free-text categories, no FK.
    await db.execute(sql`ALTER TABLE app.space_channels DROP CONSTRAINT IF EXISTS space_channels_category_fk`);
    const legacy = [
      { id: "l1", label: "#a", categoryId: " Dev", position: 1 },
      { id: "l2", label: "#b", categoryId: "Ops", position: 2 },
      { id: "l3", label: "#c", categoryId: "dev", position: 3 },
      { id: "l4", label: "#d", categoryId: "   ", position: 4 },
      { id: "l5", label: "#e", categoryId: null, position: 5 },
    ];
    for (const l of legacy) {
      await db.insert(spaceChannels).values({ spaceId: SPACE, type: "chat", ...l });
    }
    await db.execute(sql`ALTER TABLE app.channel_overrides DROP CONSTRAINT IF EXISTS channel_overrides_channel_fk`);
    await db.insert(channelOverrides).values({ roleId: member.id, channelId: "gone", permission: "SEND_MESSAGES", effect: "deny" });
    await db.insert(channelOverrides).values({ roleId: member.id, channelId: "l2", permission: "SEND_MESSAGES", effect: "deny" });

    await runMigration0039();
    const once = await getLayout();
    await runMigration0039();
    expect(await getLayout()).toEqual(once);

    expect(once.categories.map((c) => [c.id, c.name, c.position])).toEqual([["Dev", "Dev", 0], ["Ops", "Ops", 1]]);
    expect(once.channels.map((c) => [c.label, c.categoryId])).toEqual([
      ["#general", null],
      ["#d", null],
      ["#e", null],
      ["#a", "Dev"],
      ["#c", "Dev"],
      ["#b", "Ops"],
    ]);
    expectCanonical(once);
    // Synced = categorized and no overrides of its own.
    expect(byLabel(once, "#a").permissionsSynced).toBe(true);
    expect(byLabel(once, "#b").permissionsSynced).toBe(false);
    expect(await channelOverrideRows("gone")).toEqual([]);
    expect(await channelOverrideRows("l2")).toHaveLength(1);
    const fks = await db.execute(sql`
      SELECT conname FROM pg_constraint WHERE conname IN ('space_channels_category_fk', 'channel_overrides_channel_fk')
    `);
    expect([...fks].length).toBe(2);
  });
});

// ── Category permissions ────────────────────────────────────────────────

describe("category permissions", () => {
  /** LUNA creates; Text holds #general + #random; MARCUS is a plain member. */
  async function setup() {
    await createSpace(LUNA);
    await putLayout(LUNA, await docFor({
      uncategorized: ["#lounge", "#notes"],
      categories: [{ name: "Text", labels: ["#general", "#random"] }],
    }));
    const member = await roleByName(SPACE, "Member");
    await addMember(SPACE, MARCUS, [member.id]);
    return { member };
  }

  function putCategoryOverrides(user: TestUser, roleId: string, overrides: unknown[], spaceId = SPACE) {
    return server.inject({
      method: "PUT",
      url: `/spaces/${spaceId}/roles/${roleId}/category-overrides`,
      headers: as(user),
      payload: { overrides },
    });
  }

  const can = async (user: TestUser, permission: string, channelId: string) =>
    (await permissionService.check(SPACE, user.pubkey, permission, channelId)).allowed;

  it("a category override reaches its synced channels, and new channels inherit it", async () => {
    const { member } = await setup();
    const before = await getLayout();
    const general = byLabel(before, "#general");
    const lounge = byLabel(before, "#lounge");
    expect(await can(MARCUS, "SEND_MESSAGES", general.id)).toBe(true);

    const res = await putCategoryOverrides(LUNA, member.id, [{ categoryId: "Text", allow: [], deny: ["SEND_MESSAGES"] }]);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.channelsChanged).toBe(2);
    expect(await can(MARCUS, "SEND_MESSAGES", general.id)).toBe(false);
    expect(await can(MARCUS, "SEND_MESSAGES", lounge.id)).toBe(true); // not in Text

    const created = await createChannel(LUNA, { type: "chat", label: "#new", categoryId: "Text" });
    expect(created.json().data.permissionsSynced).toBe(true);
    expect(await can(MARCUS, "SEND_MESSAGES", created.json().data.id)).toBe(false);

    const get = await server.inject({ method: "GET", url: `/spaces/${SPACE}/roles/${member.id}/category-overrides`, headers: as(LUNA) });
    expect(get.json().data).toEqual([{ roleId: member.id, categoryId: "Text", allow: [], deny: ["SEND_MESSAGES"] }]);
  });

  it("editing one channel unsyncs only that channel; it then ignores category edits until synced again", async () => {
    const { member } = await setup();
    await putCategoryOverrides(LUNA, member.id, [{ categoryId: "Text", allow: [], deny: ["SEND_MESSAGES"] }]);
    const layout = await getLayout();
    const general = byLabel(layout, "#general");
    const random = byLabel(layout, "#random");

    const res = await server.inject({
      method: "PUT",
      url: `/spaces/${SPACE}/roles/${member.id}/overrides/${general.id}`,
      headers: as(LUNA),
      payload: { allow: [], deny: [] },
    });
    expect(res.statusCode).toBe(200);
    let after = await getLayout();
    expect(byLabel(after, "#general").permissionsSynced).toBe(false);
    expect(byLabel(after, "#random").permissionsSynced).toBe(true);
    expect(await can(MARCUS, "SEND_MESSAGES", general.id)).toBe(true);

    // A category edit now skips #general.
    await putCategoryOverrides(LUNA, member.id, [{ categoryId: "Text", allow: [], deny: ["SEND_MESSAGES", "ADD_REACTIONS"] }]);
    expect(await can(MARCUS, "ADD_REACTIONS", general.id)).toBe(true);
    expect(await can(MARCUS, "ADD_REACTIONS", random.id)).toBe(false);

    // Sync now.
    const sync = await server.inject({ method: "POST", url: `/spaces/${SPACE}/channels/${general.id}/sync-permissions`, headers: as(LUNA) });
    expect(sync.statusCode).toBe(200);
    expect(sync.json().data.permissionsSynced).toBe(true);
    expect(await can(MARCUS, "ADD_REACTIONS", general.id)).toBe(false);
    after = await getLayout();
    expect(byLabel(after, "#general").permissionsSynced).toBe(true);
  });

  it("the legacy whole-role PUT doesn't unsync channels it re-sends unchanged", async () => {
    const { member } = await setup();
    await putCategoryOverrides(LUNA, member.id, [{ categoryId: "Text", allow: [], deny: ["SEND_MESSAGES"] }]);
    const current = await server.inject({ method: "GET", url: `/spaces/${SPACE}/roles/${member.id}/overrides`, headers: as(LUNA) });
    const rows = current.json().data as Array<{ channelId: string; allow: string[]; deny: string[] }>;
    expect(rows).toHaveLength(2);
    const lounge = byLabel(await getLayout(), "#lounge");
    // Old desktop panel: read everything, change one channel, PUT everything back.
    const res = await server.inject({
      method: "PUT",
      url: `/spaces/${SPACE}/roles/${member.id}/overrides`,
      headers: as(LUNA),
      payload: { overrides: [...rows, { channelId: lounge.id, allow: [], deny: ["ADD_REACTIONS"] }] },
    });
    expect(res.statusCode).toBe(200);
    const after = await getLayout();
    expect(byLabel(after, "#general").permissionsSynced).toBe(true);
    expect(byLabel(after, "#random").permissionsSynced).toBe(true);
  });

  it("override writes reject foreign channels/categories, overlaps, unknown perms and ungrantable allows", async () => {
    const { member } = await setup();
    await createSpace(MARCUS, OTHER);
    const otherCh = (await getLayout(OTHER)).channels[0];
    const general = byLabel(await getLayout(), "#general");

    // Foreign channel on the whole-role PUT (silently accepted before).
    const foreign = await server.inject({
      method: "PUT",
      url: `/spaces/${SPACE}/roles/${member.id}/overrides`,
      headers: as(LUNA),
      payload: { overrides: [{ channelId: otherCh.id, allow: [], deny: ["SEND_MESSAGES"] }] },
    });
    expect(foreign.statusCode).toBe(404);
    expect(await channelOverrideRows(otherCh.id)).toEqual([]);
    // Foreign category id.
    expect((await putCategoryOverrides(LUNA, member.id, [{ categoryId: "Nope", allow: [], deny: [] }])).statusCode).toBe(400);
    // Foreign role.
    const theirMember = await roleByName(OTHER, "Member");
    expect((await putCategoryOverrides(LUNA, theirMember.id, [])).statusCode).toBe(404);
    // Allow + deny of the same permission.
    expect((await putCategoryOverrides(LUNA, member.id, [{ categoryId: "Text", allow: ["ADD_REACTIONS"], deny: ["ADD_REACTIONS"] }])).statusCode).toBe(400);
    // Unknown permission.
    expect((await putCategoryOverrides(LUNA, member.id, [{ categoryId: "Text", allow: ["FLY"], deny: [] }])).statusCode).toBe(400);
    expect(
      (await server.inject({
        method: "PUT",
        url: `/spaces/${SPACE}/roles/${member.id}/overrides/${general.id}`,
        headers: as(LUNA),
        payload: { allow: ["FLY"], deny: [] },
      })).statusCode,
    ).toBe(400);

    // A mod (MANAGE_ROLES but not MANAGE_MESSAGES) can't grant MANAGE_MESSAGES.
    const modRole = await addRole(SPACE, "Mod", 1, ["MANAGE_ROLES", "MANAGE_CHANNELS", "SEND_MESSAGES"]);
    const helper = await addRole(SPACE, "Helper", 2, []);
    await db.update(spaceRoles).set({ position: 5 }).where(eq(spaceRoles.id, member.id));
    await addMember(SPACE, ZARA, [modRole]);
    const grant = await putCategoryOverrides(ZARA, helper, [{ categoryId: "Text", allow: ["MANAGE_MESSAGES"], deny: [] }]);
    expect(grant.statusCode).toBe(403);
    expect((await putCategoryOverrides(ZARA, helper, [{ categoryId: "Text", allow: ["SEND_MESSAGES"], deny: [] }])).statusCode).toBe(200);
    // ...nor touch a role at or above their own.
    expect((await putCategoryOverrides(ZARA, modRole, [])).statusCode).toBe(403);
    expect(await db.select().from(categoryOverrides).where(eq(categoryOverrides.roleId, modRole))).toEqual([]);
  });

  it("moving a channel in copies the category's overrides only with authority over every role", async () => {
    const { member } = await setup();
    await putCategoryOverrides(LUNA, member.id, [{ categoryId: "Text", allow: [], deny: ["SEND_MESSAGES"] }]);
    // A mod with MANAGE_CHANNELS only.
    const chanMod = await addRole(SPACE, "ChanMod", 1, ["MANAGE_CHANNELS"]);
    await db.update(spaceRoles).set({ position: 5 }).where(eq(spaceRoles.id, member.id));
    await addMember(SPACE, DECKARD, [chanMod]);

    const lounge = byLabel(await getLayout(), "#lounge");
    const notes = byLabel(await getLayout(), "#notes");
    const byMod = await server.inject({
      method: "PATCH",
      url: `/spaces/${SPACE}/channels/${lounge.id}`,
      headers: as(DECKARD),
      payload: { categoryId: "Text" },
    });
    expect(byMod.statusCode).toBe(200);
    expect(byMod.json().data.permissionsSynced).toBe(false);
    expect(await channelOverrideRows(lounge.id)).toEqual([]);

    // The creator moving one in via the layout copies and syncs.
    const res = await putLayout(LUNA, await docFor({
      uncategorized: [],
      categories: [{ id: "Text", name: "Text", labels: ["#general", "#random", "#lounge", "#notes"] }],
    }));
    expect(res.statusCode).toBe(200);
    expect(byLabel(res.json().data, "#notes").permissionsSynced).toBe(true);
    expect(await can(MARCUS, "SEND_MESSAGES", notes.id)).toBe(false);
    // #lounge was already in Text (unsynced) — staying put doesn't change it.
    expect(byLabel(res.json().data, "#lounge").permissionsSynced).toBe(false);

    // Sync now needs MANAGE_ROLES.
    expect((await server.inject({ method: "POST", url: `/spaces/${SPACE}/channels/${lounge.id}/sync-permissions`, headers: as(DECKARD) })).statusCode).toBe(403);
  });

  it("a synced channel moved to another category follows the new one (with authority)", async () => {
    const { member } = await setup();
    await putLayout(LUNA, await docFor({
      uncategorized: ["#notes"],
      categories: [
        { id: "Text", name: "Text", labels: ["#general", "#random"] },
        { name: "Open", labels: ["#lounge"] },
      ],
    }));
    await putCategoryOverrides(LUNA, member.id, [{ categoryId: "Text", allow: [], deny: ["SEND_MESSAGES"] }]);
    const random = byLabel(await getLayout(), "#random");
    const general = byLabel(await getLayout(), "#general");
    expect(await can(MARCUS, "SEND_MESSAGES", random.id)).toBe(false);

    // A MANAGE_CHANNELS-only mod moves #random to Open: no authority, so it
    // keeps Text's copy and stops syncing.
    const chanMod = await addRole(SPACE, "ChanMod", 1, ["MANAGE_CHANNELS"]);
    await db.update(spaceRoles).set({ position: 5 }).where(eq(spaceRoles.id, member.id));
    await addMember(SPACE, DECKARD, [chanMod]);
    const byMod = await server.inject({
      method: "PATCH",
      url: `/spaces/${SPACE}/channels/${random.id}`,
      headers: as(DECKARD),
      payload: { categoryId: "Open" },
    });
    expect(byMod.json().data.permissionsSynced).toBe(false);
    expect(await can(MARCUS, "SEND_MESSAGES", random.id)).toBe(false);

    // The creator moves #general (synced to Text) to Open: it takes Open's (empty) template.
    const res = await putLayout(LUNA, await docFor({
      uncategorized: ["#notes"],
      categories: [
        { id: "Text", name: "Text", labels: [] },
        { id: "Open", name: "Open", labels: ["#lounge", "#random", "#general"] },
      ],
    }));
    expect(res.statusCode).toBe(200);
    expect(byLabel(res.json().data, "#general").permissionsSynced).toBe(true);
    expect(await channelOverrideRows(general.id)).toEqual([]);
    expect(await can(MARCUS, "SEND_MESSAGES", general.id)).toBe(true);
  });

  it("moving out or deleting the category keeps the copies but stops syncing", async () => {
    const { member } = await setup();
    await putCategoryOverrides(LUNA, member.id, [{ categoryId: "Text", allow: [], deny: ["SEND_MESSAGES"] }]);
    const general = byLabel(await getLayout(), "#general");
    const random = byLabel(await getLayout(), "#random");

    await server.inject({ method: "PATCH", url: `/spaces/${SPACE}/channels/${general.id}`, headers: as(LUNA), payload: { categoryId: null } });
    let layout = await getLayout();
    expect(byLabel(layout, "#general").permissionsSynced).toBe(false);
    expect(await can(MARCUS, "SEND_MESSAGES", general.id)).toBe(false);

    // Delete Text (re-home #random).
    const res = await putLayout(LUNA, await docFor({ uncategorized: ["#lounge", "#notes", "#general", "#random"], categories: [] }));
    expect(res.statusCode).toBe(200);
    layout = res.json().data;
    expect(layout.categories).toEqual([]);
    expect(byLabel(layout, "#random").permissionsSynced).toBe(false);
    expect(await can(MARCUS, "SEND_MESSAGES", random.id)).toBe(false);
    expect(await db.select().from(categoryOverrides).where(eq(categoryOverrides.spaceId, SPACE))).toEqual([]);
  });

  it("documents the deny-wins model: one role's deny beats another role's allow", async () => {
    const { member } = await setup();
    const vip = await addRole(SPACE, "VIP", 2, []);
    await addMember(SPACE, MARCUS, [vip]);
    await putCategoryOverrides(LUNA, member.id, [{ categoryId: "Text", allow: [], deny: ["SEND_MESSAGES"] }]);
    await putCategoryOverrides(LUNA, vip, [{ categoryId: "Text", allow: ["SEND_MESSAGES"], deny: [] }]);
    const general = byLabel(await getLayout(), "#general");
    // Not Discord's precedence: MARCUS holds both roles and stays denied.
    expect(await can(MARCUS, "SEND_MESSAGES", general.id)).toBe(false);
  });

  it("deleting a role cascades its category overrides", async () => {
    await setup();
    const temp = await addRole(SPACE, "Temp", 3, []);
    await putCategoryOverrides(LUNA, temp, [{ categoryId: "Text", allow: [], deny: ["ADD_REACTIONS"] }]);
    const del = await server.inject({ method: "DELETE", url: `/spaces/${SPACE}/roles/${temp}`, headers: as(LUNA) });
    expect(del.statusCode).toBe(200);
    expect(await db.select().from(categoryOverrides).where(eq(categoryOverrides.roleId, temp))).toEqual([]);
  });
});
