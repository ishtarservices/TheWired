import { describe, it, expect } from "vitest";
import {
  buildChannelFilter,
  buildProfileFilter,
  buildRelayListFilter,
  buildUserListsFilter,
  buildNotesFilter,
  buildProfileFeedFilter,
  buildProfileArticlesFilter,
  buildFollowersFilter,
  buildSpaceFeedFilter,
  buildAnnotationFilter,
  buildUserAnnotationsFilter,
} from "../filterBuilder";
import { EVENT_KINDS } from "@/types/nostr";
import { lunaVega, marcusCole } from "@/__tests__/fixtures/testUsers";

const PK = lunaVega.pubkey;

describe("buildChannelFilter", () => {
  it("builds a filter with kinds and h-tag when route uses h-tag", () => {
    const route = { kinds: [9], pageSize: 50, usesHTag: true, adminOnly: false, sortOrder: "asc" as const };
    const filter = buildChannelFilter(route, "group-1");
    expect(filter.kinds).toEqual([9]);
    expect(filter["#h"]).toEqual(["group-1"]);
    expect(filter.limit).toBe(50);
  });

  it("respects custom limit", () => {
    const route = { kinds: [9], pageSize: 50, usesHTag: true, adminOnly: false, sortOrder: "asc" as const };
    const filter = buildChannelFilter(route, "g", { limit: 10 });
    expect(filter.limit).toBe(10);
  });

  it("omits h-tag when route does not use it", () => {
    const route = { kinds: [1], pageSize: 30, usesHTag: false, adminOnly: false, sortOrder: "desc" as const };
    const filter = buildChannelFilter(route, "group-1");
    expect(filter["#h"]).toBeUndefined();
  });

  it("adds authors filter for admin-only channels", () => {
    const route = { kinds: [1], pageSize: 20, usesHTag: false, adminOnly: true, sortOrder: "desc" as const };
    const filter = buildChannelFilter(route, "g", { adminPubkeys: [PK] });
    expect(filter.authors).toEqual([PK]);
  });

  it("adds since and until when provided", () => {
    const route = { kinds: [9], pageSize: 50, usesHTag: true, adminOnly: false, sortOrder: "asc" as const };
    const filter = buildChannelFilter(route, "g", { since: 100, until: 200 });
    expect(filter.since).toBe(100);
    expect(filter.until).toBe(200);
  });
});

describe("buildProfileFilter", () => {
  it("builds a kind:0 filter for pubkeys", () => {
    const filter = buildProfileFilter([PK, marcusCole.pubkey]);
    expect(filter.kinds).toEqual([0]);
    expect(filter.authors).toEqual([PK, marcusCole.pubkey]);
  });
});

describe("buildRelayListFilter", () => {
  it("builds a kind:10002 filter for a single pubkey", () => {
    const filter = buildRelayListFilter(PK);
    expect(filter.kinds).toEqual([10002]);
    expect(filter.authors).toEqual([PK]);
  });
});

describe("buildUserListsFilter", () => {
  it("builds a filter for kind:3 and kind:10000", () => {
    const filter = buildUserListsFilter(PK);
    expect(filter.kinds).toEqual([3, 10000]);
    expect(filter.authors).toEqual([PK]);
  });
});

describe("buildNotesFilter", () => {
  it("builds a kind:1 filter with default limit of 50", () => {
    const filter = buildNotesFilter(PK);
    expect(filter.kinds).toEqual([1]);
    expect(filter.authors).toEqual([PK]);
    expect(filter.limit).toBe(50);
  });

  it("respects custom limit", () => {
    const filter = buildNotesFilter(PK, 10);
    expect(filter.limit).toBe(10);
  });
});

describe("buildProfileFeedFilter", () => {
  it("includes kind:1 and kind:6 (notes + reposts)", () => {
    const filter = buildProfileFeedFilter(PK);
    expect(filter.kinds).toEqual([1, 6]);
    expect(filter.limit).toBe(50);
  });
});

describe("buildProfileArticlesFilter", () => {
  it("builds a kind:30023 filter", () => {
    const filter = buildProfileArticlesFilter(PK);
    expect(filter.kinds).toEqual([30023]);
    expect(filter.limit).toBe(20);
  });
});

describe("buildFollowersFilter", () => {
  it("builds a kind:3 filter with #p tag", () => {
    const filter = buildFollowersFilter(PK);
    expect(filter.kinds).toEqual([3]);
    expect(filter["#p"]).toEqual([PK]);
    expect(filter.limit).toBe(500);
  });
});

describe("buildSpaceFeedFilter", () => {
  it("builds an author-scoped filter", () => {
    const filter = buildSpaceFeedFilter([PK, marcusCole.pubkey], [1, 6], 100);
    expect(filter.authors).toEqual([PK, marcusCole.pubkey]);
    expect(filter.kinds).toEqual([1, 6]);
    expect(filter.limit).toBe(100);
  });
});

describe("buildAnnotationFilter", () => {
  it("builds a filter for music track annotations", () => {
    const ref = `${EVENT_KINDS.MUSIC_TRACK}:${PK}:my-track`;
    const filter = buildAnnotationFilter(ref);
    expect(filter.kinds).toEqual([EVENT_KINDS.MUSIC_TRACK_NOTES]);
    expect(filter["#a"]).toEqual([ref]);
    expect(filter.limit).toBe(100);
  });
});

describe("buildUserAnnotationsFilter", () => {
  it("builds a filter for user's own annotations", () => {
    const filter = buildUserAnnotationsFilter(PK, 50);
    expect(filter.kinds).toEqual([EVENT_KINDS.MUSIC_TRACK_NOTES]);
    expect(filter.authors).toEqual([PK]);
    expect(filter.limit).toBe(50);
  });
});
