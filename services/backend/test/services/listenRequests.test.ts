/**
 * Listen requests (kind 31685 + one `grant_access` change) and the indexer's
 * one-row-per-addressable-event rule. Before migration 0031 every relay
 * re-delivery added a row (one dev request had 9), and nothing stopped a
 * requester from re-asking after a decline or flooding owners. These pin the
 * gates that decide what reaches an owner's inbox.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../../src/db/connection.js";
import { musicProposals } from "../../src/db/schema/proposals.js";
import {
  proposalService,
  ACCESS_REQUEST_COOLDOWN_SEC,
  MAX_OPEN_ACCESS_REQUESTS,
} from "../../src/services/proposalService.js";
import { nanoid } from "../../src/lib/id.js";
import {
  ensureRelayEventsTable,
  insertMusicEvent,
  deleteRelayEventsBySlugPrefix,
} from "../helpers/relayEvents.js";
import { LUNA, MARCUS, ZARA, SAGE } from "../helpers/testUsers.js";

const SLUG = "listenreq"; // file-unique slug prefix (cleaned up in afterAll)
const PRIVATE_TRACK = `${SLUG}-private`;
const GRANTED_TRACK = `${SLUG}-granted`;
const PUBLIC_TRACK = `${SLUG}-public`;
const PRIVATE_PROJECT = `${SLUG}-project`;

const trackRef = (slug: string) => `31683:${LUNA.pubkey}:${slug}`;
const now = () => Math.floor(Date.now() / 1000);

let seq = 0;
function requestEvent(opts: {
  target: string;
  owner?: string;
  proposer?: string;
  d?: string;
  createdAt?: number;
  status?: string;
}) {
  seq += 1;
  const d = opts.d ?? `req-${SLUG}-${seq}`;
  return {
    id: `${SLUG}-ev-${seq}`,
    pubkey: opts.proposer ?? MARCUS.pubkey,
    created_at: opts.createdAt ?? now(),
    kind: 31685,
    tags: [
      ["d", d],
      ["a", opts.target],
      ["p", opts.owner ?? LUNA.pubkey],
      ["status", opts.status ?? "open"],
    ],
    content: JSON.stringify({ title: "listen request", changes: [{ type: "grant_access", role: "viewer" }] }),
    sig: "0".repeat(128),
  };
}

async function rowsFrom(proposer: string) {
  return db.select().from(musicProposals).where(eq(musicProposals.proposerPubkey, proposer));
}

async function setStatus(addressableId: string, status: string, resolvedAt: number) {
  await db
    .update(musicProposals)
    .set({ status, resolvedAt })
    .where(eq(musicProposals.addressableId, addressableId));
}

beforeAll(async () => {
  await ensureRelayEventsTable();
  await insertMusicEvent({ kind: 31683, pubkey: LUNA.pubkey, slug: PRIVATE_TRACK, visibility: "private" });
  await insertMusicEvent({
    kind: 31683,
    pubkey: LUNA.pubkey,
    slug: GRANTED_TRACK,
    visibility: "private",
    pTags: [
      ["p", MARCUS.pubkey, "", "collaborator"],
      ["p", SAGE.pubkey, "", "featured"],
    ],
  });
  await insertMusicEvent({ kind: 31683, pubkey: LUNA.pubkey, slug: PUBLIC_TRACK });
  await insertMusicEvent({ kind: 33123, pubkey: LUNA.pubkey, slug: PRIVATE_PROJECT, visibility: "private" });
});

afterAll(async () => {
  await deleteRelayEventsBySlugPrefix(SLUG);
});

describe("one row per addressable event", () => {
  it("a re-delivered event does not add a row", async () => {
    const ev = requestEvent({ target: trackRef(PRIVATE_TRACK) });
    for (let i = 0; i < 4; i++) await proposalService.indexProposal(ev);
    expect(await rowsFrom(MARCUS.pubkey)).toHaveLength(1);
  });

  it("a newer version replaces the row; an older one is ignored", async () => {
    const t = now();
    const first = requestEvent({ target: trackRef(PRIVATE_TRACK), d: `req-${SLUG}-v`, createdAt: t - 10 });
    await proposalService.indexProposal(first);
    const newer = { ...requestEvent({ target: trackRef(PRIVATE_TRACK), d: `req-${SLUG}-v`, createdAt: t }) };
    await proposalService.indexProposal(newer);
    await proposalService.indexProposal(first);
    const rows = await rowsFrom(MARCUS.pubkey);
    expect(rows).toHaveLength(1);
    expect(rows[0].eventId).toBe(newer.id);
    expect(rows[0].createdAt).toBe(t);
  });

  it("ignores the proposer's own status tag", async () => {
    await proposalService.indexProposal(requestEvent({ target: trackRef(PRIVATE_TRACK), status: "accepted" }));
    const [row] = await rowsFrom(MARCUS.pubkey);
    expect(row.status).toBe("open");
  });

  it("drops a proposal whose p tag is not the address's author, seen or not", async () => {
    await proposalService.indexProposal(
      requestEvent({ target: `31683:${LUNA.pubkey}:${SLUG}-never-published`, owner: ZARA.pubkey }),
    );
    expect(await rowsFrom(MARCUS.pubkey)).toHaveLength(0);
  });
});

describe("listen request admission", () => {
  it("admits an outsider's request for a private track, stored canonically", async () => {
    await proposalService.indexProposal(requestEvent({ target: trackRef(PRIVATE_TRACK) }));
    const rows = await rowsFrom(MARCUS.pubkey);
    expect(rows).toHaveLength(1);
    expect(rows[0].changes).toEqual([{ type: "grant_access", role: "viewer" }]);
    expect(rows[0].ownerPubkey).toBe(LUNA.pubkey);
  });

  it("admits a request for a private project", async () => {
    await proposalService.indexProposal(requestEvent({ target: `33123:${LUNA.pubkey}:${PRIVATE_PROJECT}` }));
    expect(await rowsFrom(MARCUS.pubkey)).toHaveLength(1);
  });

  it.each([
    ["a malformed target", `31683:${SLUG}-no-pubkey`],
    ["a target that was never published", trackRef(`${SLUG}-missing`)],
    ["a public target (they can already play it)", trackRef(PUBLIC_TRACK)],
    ["a target they already hold a grant on", trackRef(GRANTED_TRACK)],
  ])("drops %s", async (_label, target) => {
    await proposalService.indexProposal(requestEvent({ target }));
    expect(await rowsFrom(MARCUS.pubkey)).toHaveLength(0);
  });

  it("a featured credit is not a grant: they may still ask", async () => {
    await proposalService.indexProposal(requestEvent({ target: trackRef(GRANTED_TRACK), proposer: SAGE.pubkey }));
    expect(await rowsFrom(SAGE.pubkey)).toHaveLength(1);
  });

  it("drops the owner asking for their own track", async () => {
    await proposalService.indexProposal(requestEvent({ target: trackRef(PRIVATE_TRACK), proposer: LUNA.pubkey }));
    expect(await rowsFrom(LUNA.pubkey)).toHaveLength(0);
  });

  it("keeps one open request per requester and target across d-tags", async () => {
    await proposalService.indexProposal(requestEvent({ target: trackRef(PRIVATE_TRACK) }));
    await proposalService.indexProposal(requestEvent({ target: trackRef(PRIVATE_TRACK) }));
    expect(await rowsFrom(MARCUS.pubkey)).toHaveLength(1);
  });
});

describe("asking again after a decline", () => {
  const d = `req-${SLUG}-again`;
  const addressableId = `31685:${MARCUS.pubkey}:${d}`;

  it("stays declined inside the cooldown (same d-tag)", async () => {
    const t = now();
    await proposalService.indexProposal(requestEvent({ target: trackRef(PRIVATE_TRACK), d, createdAt: t - 60 }));
    await setStatus(addressableId, "rejected", t - 30);
    await proposalService.indexProposal(requestEvent({ target: trackRef(PRIVATE_TRACK), d, createdAt: t }));
    const [row] = await rowsFrom(MARCUS.pubkey);
    expect(row.status).toBe("rejected");
  });

  it("stays declined inside the cooldown (a fresh d-tag)", async () => {
    const t = now();
    await proposalService.indexProposal(requestEvent({ target: trackRef(PRIVATE_TRACK), d, createdAt: t - 60 }));
    await setStatus(addressableId, "rejected", t - 30);
    await proposalService.indexProposal(requestEvent({ target: trackRef(PRIVATE_TRACK) }));
    const rows = await rowsFrom(MARCUS.pubkey);
    expect(rows.map((r) => r.status)).toEqual(["rejected"]);
  });

  it("reopens once the cooldown has passed", async () => {
    const t = now();
    const longAgo = t - ACCESS_REQUEST_COOLDOWN_SEC - 120;
    await proposalService.indexProposal(requestEvent({ target: trackRef(PRIVATE_TRACK), d, createdAt: longAgo - 60 }));
    await setStatus(addressableId, "rejected", longAgo);
    await proposalService.indexProposal(requestEvent({ target: trackRef(PRIVATE_TRACK), d, createdAt: t }));
    const [row] = await rowsFrom(MARCUS.pubkey);
    expect(row.status).toBe("open");
    expect(row.resolvedAt).toBeNull();
  });

  it("an accepted request reopens when asked again after a revoke", async () => {
    const t = now();
    await proposalService.indexProposal(requestEvent({ target: trackRef(PRIVATE_TRACK), d, createdAt: t - 60 }));
    await setStatus(addressableId, "accepted", t - 30);
    // The owner revoked (the track carries no grant for them), so they ask again.
    await proposalService.indexProposal(requestEvent({ target: trackRef(PRIVATE_TRACK), d, createdAt: t }));
    const [row] = await rowsFrom(MARCUS.pubkey);
    expect(row.status).toBe("open");
  });
});

describe("per-requester open cap", () => {
  it(`drops request ${MAX_OPEN_ACCESS_REQUESTS + 1}`, async () => {
    for (let i = 0; i < MAX_OPEN_ACCESS_REQUESTS; i++) {
      await db.insert(musicProposals).values({
        id: nanoid(16),
        proposalId: `req-cap-${i}`,
        addressableId: `31685:${ZARA.pubkey}:req-cap-${i}`,
        targetAlbum: `31683:${MARCUS.pubkey}:cap-${i}`,
        proposerPubkey: ZARA.pubkey,
        ownerPubkey: MARCUS.pubkey,
        title: "listen request",
        changes: [{ type: "grant_access", role: "viewer" }],
        status: "open",
        eventId: nanoid(16),
        createdAt: now(),
      });
    }
    await proposalService.indexProposal(requestEvent({ target: trackRef(PRIVATE_TRACK), proposer: ZARA.pubkey }));
    const toLuna = await db
      .select()
      .from(musicProposals)
      .where(and(eq(musicProposals.proposerPubkey, ZARA.pubkey), eq(musicProposals.ownerPubkey, LUNA.pubkey)));
    expect(toLuna).toHaveLength(0);
  });
});

describe("where listen requests show up", () => {
  it("in the owner's inbox, never in the project's public proposal list", async () => {
    const project = `33123:${LUNA.pubkey}:${PRIVATE_PROJECT}`;
    await proposalService.indexProposal(requestEvent({ target: project }));
    await db.insert(musicProposals).values({
      id: nanoid(16),
      proposalId: `${SLUG}-tracklist`,
      addressableId: `31685:${ZARA.pubkey}:${SLUG}-tracklist`,
      targetAlbum: project,
      proposerPubkey: ZARA.pubkey,
      ownerPubkey: LUNA.pubkey,
      title: "add a track",
      changes: [{ type: "add_track", trackRef: `31683:${ZARA.pubkey}:wip` }],
      status: "open",
      eventId: nanoid(16),
      createdAt: now(),
    });

    const listed = await proposalService.getProposalsForAlbum(project);
    expect(listed.map((p) => p.title)).toEqual(["add a track"]);

    const incoming = await proposalService.getIncomingProposals(LUNA.pubkey);
    expect(incoming.map((p) => p.title).sort()).toEqual(["add a track", "listen request"]);
  });
});
