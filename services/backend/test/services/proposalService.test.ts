/**
 * proposalService.indexProposal: the `p` tag names who may resolve the
 * proposal, so it must match the target project's author. A mismatched
 * proposal is dropped; a proposal whose project has not arrived yet is still
 * indexed (relay delivery order is not guaranteed).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../src/db/connection.js";
import { musicProposals } from "../../src/db/schema/proposals.js";
import { proposalService } from "../../src/services/proposalService.js";
import {
  ensureRelayEventsTable,
  insertMusicEvent,
  deleteRelayEventsBySlugPrefix,
} from "../helpers/relayEvents.js";
import { LUNA, MARCUS, ZARA } from "../helpers/testUsers.js";

const SLUG = "propidx"; // file-unique slug prefix (cleaned up in afterAll)
const PROJECT = `${SLUG}-proj`;

function proposalEvent(opts: { d: string; target: string; owner: string }) {
  return {
    id: `${opts.d}-${opts.owner.slice(0, 8)}`,
    pubkey: MARCUS.pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 31685,
    tags: [
      ["d", opts.d],
      ["a", opts.target],
      ["p", opts.owner],
      ["status", "open"],
    ],
    content: JSON.stringify({
      title: opts.d,
      changes: [{ type: "add_track", trackRef: `31683:${MARCUS.pubkey}:wip` }],
    }),
    sig: "0".repeat(128),
  };
}

async function rowsFor(d: string) {
  return db.select().from(musicProposals).where(eq(musicProposals.proposalId, d));
}

beforeAll(async () => {
  await ensureRelayEventsTable();
  await insertMusicEvent({ kind: 33123, pubkey: LUNA.pubkey, slug: PROJECT });
});

afterAll(async () => {
  await deleteRelayEventsBySlugPrefix(SLUG);
});

describe("proposalService.indexProposal owner check", () => {
  it("indexes a proposal whose p tag is the project's author", async () => {
    await proposalService.indexProposal(
      proposalEvent({ d: `${SLUG}-ok`, target: `33123:${LUNA.pubkey}:${PROJECT}`, owner: LUNA.pubkey }),
    );
    const rows = await rowsFor(`${SLUG}-ok`);
    expect(rows).toHaveLength(1);
    expect(rows[0].ownerPubkey).toBe(LUNA.pubkey);
    expect(rows[0].targetAlbum).toBe(`33123:${LUNA.pubkey}:${PROJECT}`);
  });

  it("drops a proposal whose p tag is not the project's author", async () => {
    await proposalService.indexProposal(
      proposalEvent({ d: `${SLUG}-bad`, target: `33123:${LUNA.pubkey}:${PROJECT}`, owner: ZARA.pubkey }),
    );
    expect(await rowsFor(`${SLUG}-bad`)).toHaveLength(0);
  });

  it("still indexes a proposal for a project the backend has not seen yet", async () => {
    await proposalService.indexProposal(
      proposalEvent({
        d: `${SLUG}-early`,
        target: `33123:${LUNA.pubkey}:${SLUG}-not-yet-published`,
        owner: LUNA.pubkey,
      }),
    );
    expect(await rowsFor(`${SLUG}-early`)).toHaveLength(1);
  });
});
