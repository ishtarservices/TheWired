import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestServer, closeTestServer } from "../helpers/testServer.js";
import { getMeilisearchClient } from "../../src/lib/meilisearch.js";
import { LUNA, MARCUS } from "../helpers/testUsers.js";

/**
 * `GET /search/people` backs two different surfaces: search (with `q`) and the
 * default "people worth following" browse list (without `q`). The browse form
 * is the one that has to produce a *deliberate* ordering, so these tests assert
 * on the Meilisearch query the route builds — the mock index in test/setup.ts
 * stands in for the engine.
 */

let server: FastifyInstance;
let index: {
  search: ReturnType<typeof vi.fn>;
};

beforeAll(async () => {
  server = await buildTestServer();
  index = getMeilisearchClient().index("profiles") as never;
});

afterAll(async () => {
  await closeTestServer();
});

beforeEach(() => {
  index.search.mockReset();
  index.search.mockResolvedValue({ hits: [], estimatedTotalHits: 0 });
});

/** Guest request — no Authorization header. */
function guestGet(url: string) {
  return server.inject({ method: "GET", url });
}

/** The options object the route handed Meilisearch. */
function searchOpts() {
  return index.search.mock.calls[0][1];
}

function searchQuery() {
  return index.search.mock.calls[0][0];
}

describe("GET /search/people", () => {
  it("is readable by a signed-out guest", async () => {
    const res = await guestGet("/search/people");
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ people: [], total: 0 });
  });

  it("works with no q at all — the browse form is not a degenerate search", async () => {
    const res = await guestGet("/search/people");
    expect(res.statusCode).toBe(200);
    expect(searchQuery()).toBe("");
  });

  it("defaults the q-less browse list to note_count:desc", async () => {
    await guestGet("/search/people");
    expect(searchOpts().sort).toEqual(["note_count:desc"]);
  });

  it("leaves relevance first when a query is given", async () => {
    await guestGet("/search/people?q=luna");
    expect(searchQuery()).toBe("luna");
    expect(searchOpts().sort).toBeUndefined();
  });

  it("honours an explicit sort even alongside a query", async () => {
    await guestGet("/search/people?q=luna&sort=note_count:desc");
    expect(searchOpts().sort).toEqual(["note_count:desc"]);
  });

  it("accepts ascending order", async () => {
    await guestGet("/search/people?sort=note_count:asc");
    expect(searchOpts().sort).toEqual(["note_count:asc"]);
  });

  it("drops a sort on a non-sortable field instead of 500ing on Meilisearch", async () => {
    // A stale client asking for an unindexed field must not break the browse
    // list — Meilisearch 400s on a non-sortable attribute.
    await guestGet("/search/people?sort=about:desc");
    expect(searchOpts().sort).toEqual(["note_count:desc"]);
  });

  it("filters to verified handles with hasNip05=true", async () => {
    await guestGet("/search/people?hasNip05=true");
    expect(searchOpts().filter).toBe("has_nip05 = true");
  });

  it("can invert the filter to find people without a NIP-05", async () => {
    await guestGet("/search/people?hasNip05=false");
    expect(searchOpts().filter).toBe("has_nip05 = false");
  });

  it("applies no filter when hasNip05 is omitted", async () => {
    await guestGet("/search/people");
    expect(searchOpts().filter).toBeUndefined();
  });

  it("rejects a non-boolean hasNip05", async () => {
    const res = await guestGet("/search/people?hasNip05=yes");
    expect(res.statusCode).toBe(400);
  });

  it("defaults to 30 results and caps at 100", async () => {
    await guestGet("/search/people");
    expect(searchOpts().limit).toBe(30);

    index.search.mockClear();
    const res = await guestGet("/search/people?limit=500");
    expect(res.statusCode).toBe(400);
  });

  it("paginates", async () => {
    await guestGet("/search/people?limit=10&offset=20");
    expect(searchOpts()).toMatchObject({ limit: 10, offset: 20 });
  });

  it("returns the hits and total under data.people", async () => {
    index.search.mockResolvedValue({
      hits: [
        { pubkey: LUNA.pubkey, name: "luna", nip05: "luna@thewired.app", has_nip05: true, note_count: 42 },
        { pubkey: MARCUS.pubkey, name: "marcus", has_nip05: false, note_count: 7 },
      ],
      estimatedTotalHits: 2,
    });

    const body = (await guestGet("/search/people")).json();
    expect(body.data.total).toBe(2);
    expect(body.data.people).toHaveLength(2);
    expect(body.data.people[0]).toMatchObject({ pubkey: LUNA.pubkey, note_count: 42 });
  });
});
