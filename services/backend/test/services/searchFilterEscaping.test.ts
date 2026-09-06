import { describe, it, expect, beforeEach, vi } from "vitest";
import { getMeilisearchClient } from "../../src/lib/meilisearch.js";
import { escapeMsFilter } from "../../src/lib/meiliFilter.js";
import { searchService } from "../../src/services/searchService.js";

/**
 * Meilisearch filter values are interpolated into a quoted literal
 * (`genre = "<value>"`), so an unescaped `"` in caller-supplied input closes the
 * literal and the rest is parsed as filter syntax. searchMusic interpolated
 * `genre` and `hashtag` raw while the sibling musicService paths escaped the
 * same two fields.
 */

let index: { search: ReturnType<typeof vi.fn> };

beforeEach(() => {
  index = getMeilisearchClient().index("tracks") as never;
  index.search.mockClear();
});

function lastFilter(): string | undefined {
  const calls = index.search.mock.calls;
  return calls[calls.length - 1][1].filter;
}

describe("escapeMsFilter", () => {
  it("strips the characters that can break out of a quoted literal", () => {
    expect(escapeMsFilter('techno" OR pubkey = "x')).toBe("techno OR pubkey = x");
    expect(escapeMsFilter('back\\slash')).toBe("backslash");
  });

  it("leaves ordinary values alone", () => {
    expect(escapeMsFilter("drum & bass")).toBe("drum & bass");
    expect(escapeMsFilter("")).toBe("");
  });
});

describe("searchService.searchMusic filter building", () => {
  it("escapes an injected quote in `genre`", async () => {
    await searchService.searchMusic("", { type: "track", genre: 'techno" OR visibility = "private' });

    const filter = lastFilter();
    expect(filter).toBe('genre = "techno OR visibility = private"');
    // One opening + one closing quote — the literal is never broken out of.
    expect(filter!.match(/"/g)).toHaveLength(2);
  });

  it("escapes an injected quote in `hashtag`", async () => {
    await searchService.searchMusic("", { type: "track", hashtag: 'x" OR pubkey = "y' });

    expect(lastFilter()).toBe('hashtags = "x OR pubkey = y"');
  });

  it("still builds the ordinary filter unchanged", async () => {
    await searchService.searchMusic("", { type: "track", genre: "Techno", hashtag: "vinyl" });

    expect(lastFilter()).toBe('genre = "Techno" AND hashtags = "vinyl"');
  });

  it("passes no filter when neither field is given", async () => {
    await searchService.searchMusic("anything", { type: "track" });

    expect(lastFilter()).toBeUndefined();
  });
});
