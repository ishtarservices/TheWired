import { describe, it, expect, beforeEach } from "vitest";
import {
  loadArticleDraft,
  saveArticleDraft,
  clearArticleDraft,
  type ArticleDraft,
} from "../useArticleDraft";

const PK = "abc123";

function makeDraft(over: Partial<ArticleDraft> = {}): ArticleDraft {
  return {
    title: "My title",
    summary: "sum",
    image: "",
    tags: "nostr, wired",
    content: "body",
    visibility: "public",
    spaceId: "",
    channelId: "",
    savedAt: 123,
    ...over,
  };
}

describe("article draft storage", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips a saved draft", () => {
    const d = makeDraft();
    saveArticleDraft(PK, "new", d);
    expect(loadArticleDraft(PK, "new")).toEqual(d);
  });

  it("returns null when nothing is saved", () => {
    expect(loadArticleDraft(PK, "new")).toBeNull();
  });

  it("isolates drafts per account and per article id (no clobber)", () => {
    saveArticleDraft(PK, "new", makeDraft({ title: "A" }));
    saveArticleDraft(PK, "my-slug", makeDraft({ title: "B" }));
    saveArticleDraft("other", "new", makeDraft({ title: "C" }));

    expect(loadArticleDraft(PK, "new")?.title).toBe("A");
    expect(loadArticleDraft(PK, "my-slug")?.title).toBe("B");
    expect(loadArticleDraft("other", "new")?.title).toBe("C");
  });

  it("clear() removes only the targeted draft", () => {
    saveArticleDraft(PK, "new", makeDraft({ title: "A" }));
    saveArticleDraft(PK, "my-slug", makeDraft({ title: "B" }));
    clearArticleDraft(PK, "new");
    expect(loadArticleDraft(PK, "new")).toBeNull();
    expect(loadArticleDraft(PK, "my-slug")?.title).toBe("B");
  });

  it("survives a corrupt/malformed JSON value", () => {
    localStorage.setItem(`wired:article-draft:${PK}:new`, "{not valid json");
    expect(loadArticleDraft(PK, "new")).toBeNull();
  });

  it("fills defaults for a partial older draft shape", () => {
    localStorage.setItem(
      `wired:article-draft:${PK}:new`,
      JSON.stringify({ title: "Only title" }),
    );
    const d = loadArticleDraft(PK, "new");
    expect(d).not.toBeNull();
    expect(d?.title).toBe("Only title");
    expect(d?.content).toBe("");
    expect(d?.visibility).toBe("public");
  });

  it("normalizes an unknown visibility back to public", () => {
    saveArticleDraft(PK, "new", makeDraft({ visibility: "weird" as never }));
    expect(loadArticleDraft(PK, "new")?.visibility).toBe("public");
  });

  it("no-ops safely when pubkey is empty", () => {
    saveArticleDraft("", "new", makeDraft());
    expect(loadArticleDraft("", "new")).toBeNull();
  });
});
