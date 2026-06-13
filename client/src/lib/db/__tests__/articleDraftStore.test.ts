import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { getDB } from "../database";
import {
  upsertDraft,
  getDraft,
  getDraftsForAccount,
  deleteDraft,
  renameDraft,
  migrateLegacyArticleDraft,
  MAX_DRAFTS_PER_ACCOUNT,
} from "../articleDraftStore";
import type { ArticleDraftFields } from "@/types/media";

function fields(over: Partial<ArticleDraftFields> = {}): ArticleDraftFields {
  return {
    title: "My title",
    summary: "sum",
    image: "",
    tags: "nostr, wired",
    content: "body",
    visibility: "public",
    spaceId: "",
    channelId: "",
    ...over,
  };
}

beforeEach(async () => {
  const db = await getDB();
  await db.clear("articleDrafts");
  localStorage.clear();
});

describe("articleDraftStore — CRUD", () => {
  it("round-trips an upserted draft", async () => {
    const saved = await upsertDraft("acct", "d1", fields(), 1000);
    expect(saved).toMatchObject({ id: "d1", title: "My title", createdAt: 1000, updatedAt: 1000 });
    const got = await getDraft("d1");
    expect(got).toEqual(saved);
  });

  it("returns undefined for a missing draft", async () => {
    expect(await getDraft("nope")).toBeUndefined();
  });

  it("preserves createdAt across updates but bumps updatedAt", async () => {
    await upsertDraft("acct", "d1", fields({ title: "v1" }), 1000);
    const updated = await upsertDraft("acct", "d1", fields({ title: "v2" }), 5000);
    expect(updated.title).toBe("v2");
    expect(updated.createdAt).toBe(1000); // unchanged
    expect(updated.updatedAt).toBe(5000); // bumped
    // Still a single record, not a duplicate.
    expect(await getDraftsForAccount("acct")).toHaveLength(1);
  });

  it("lists drafts most-recently-edited first", async () => {
    await upsertDraft("acct", "old", fields({ title: "old" }), 1000);
    await upsertDraft("acct", "new", fields({ title: "new" }), 3000);
    await upsertDraft("acct", "mid", fields({ title: "mid" }), 2000);
    const list = await getDraftsForAccount("acct");
    expect(list.map((d) => d.id)).toEqual(["new", "mid", "old"]);
  });

  it("deletes only the targeted draft", async () => {
    await upsertDraft("acct", "a", fields(), 1000);
    await upsertDraft("acct", "b", fields(), 2000);
    await deleteDraft("a");
    expect(await getDraft("a")).toBeUndefined();
    expect(await getDraft("b")).not.toBeUndefined();
  });

  it("renames a draft and bumps updatedAt", async () => {
    await upsertDraft("acct", "a", fields({ title: "Before" }), 1000);
    await renameDraft("a", "After", 4000);
    const got = await getDraft("a");
    expect(got?.title).toBe("After");
    expect(got?.updatedAt).toBe(4000);
    expect(got?.createdAt).toBe(1000);
  });

  it("rename is a no-op for a missing draft", async () => {
    await renameDraft("ghost", "x");
    expect(await getDraft("ghost")).toBeUndefined();
  });
});

describe("articleDraftStore — multi-account isolation", () => {
  it("keeps each account's drafts separate", async () => {
    await upsertDraft("alice", "a1", fields({ title: "A" }), 1000);
    await upsertDraft("bob", "b1", fields({ title: "B" }), 1000);

    const alice = await getDraftsForAccount("alice");
    const bob = await getDraftsForAccount("bob");
    expect(alice.map((d) => d.title)).toEqual(["A"]);
    expect(bob.map((d) => d.title)).toEqual(["B"]);
  });
});

describe("articleDraftStore — eviction cap", () => {
  it("drops oldest drafts once the per-account cap is exceeded", async () => {
    const overBy = 2;
    for (let i = 0; i < MAX_DRAFTS_PER_ACCOUNT + overBy; i++) {
      // strictly increasing updatedAt so order is deterministic
      await upsertDraft("acct", `d${i}`, fields({ title: `t${i}` }), 1000 + i);
    }
    const list = await getDraftsForAccount("acct");
    expect(list).toHaveLength(MAX_DRAFTS_PER_ACCOUNT);
    // The two oldest (d0, d1) were evicted; the newest survives.
    expect(await getDraft("d0")).toBeUndefined();
    expect(await getDraft("d1")).toBeUndefined();
    expect(await getDraft(`d${MAX_DRAFTS_PER_ACCOUNT + overBy - 1}`)).not.toBeUndefined();
  });

  it("does not evict another account's drafts", async () => {
    await upsertDraft("other", "keep", fields(), 1);
    for (let i = 0; i < MAX_DRAFTS_PER_ACCOUNT + 1; i++) {
      await upsertDraft("acct", `d${i}`, fields(), 1000 + i);
    }
    expect(await getDraft("keep")).not.toBeUndefined();
  });
});

describe("articleDraftStore — legacy migration", () => {
  const legacyKey = (pk: string) => `wired:article-draft:${pk}:new`;

  it("imports the old localStorage 'new' draft and removes the key", async () => {
    const pk = "mig-1";
    localStorage.setItem(
      legacyKey(pk),
      JSON.stringify({
        title: "Legacy title",
        summary: "s",
        image: "",
        tags: "a, b",
        content: "legacy body",
        visibility: "space",
        spaceId: "space-x",
        channelId: "chan-y",
        savedAt: 1700,
      }),
    );

    const id = await migrateLegacyArticleDraft(pk);
    expect(id).not.toBeNull();
    expect(localStorage.getItem(legacyKey(pk))).toBeNull();

    const list = await getDraftsForAccount(pk);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      title: "Legacy title",
      content: "legacy body",
      visibility: "space",
      spaceId: "space-x",
      channelId: "chan-y",
      updatedAt: 1700 * 1000, // savedAt (seconds) → ms
    });
  });

  it("is idempotent — a second call imports nothing", async () => {
    const pk = "mig-2";
    localStorage.setItem(legacyKey(pk), JSON.stringify({ title: "Once", content: "x", savedAt: 1 }));
    expect(await migrateLegacyArticleDraft(pk)).not.toBeNull();
    expect(await migrateLegacyArticleDraft(pk)).toBeNull();
    expect(await getDraftsForAccount(pk)).toHaveLength(1);
  });

  it("removes an empty/meaningless legacy slot without creating a record", async () => {
    const pk = "mig-3";
    localStorage.setItem(legacyKey(pk), JSON.stringify({ title: "   ", content: "" }));
    expect(await migrateLegacyArticleDraft(pk)).toBeNull();
    expect(localStorage.getItem(legacyKey(pk))).toBeNull();
    expect(await getDraftsForAccount(pk)).toHaveLength(0);
  });

  it("survives a corrupt legacy value and clears it", async () => {
    const pk = "mig-4";
    localStorage.setItem(legacyKey(pk), "{not json");
    expect(await migrateLegacyArticleDraft(pk)).toBeNull();
    expect(localStorage.getItem(legacyKey(pk))).toBeNull();
  });

  it("no-ops when there is nothing to migrate", async () => {
    expect(await migrateLegacyArticleDraft("mig-5")).toBeNull();
  });
});
