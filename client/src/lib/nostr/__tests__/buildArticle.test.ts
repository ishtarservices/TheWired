import { describe, it, expect } from "vitest";
import { buildArticle } from "../eventBuilder";

function tagVal(tags: string[][], key: string): string | undefined {
  return tags.find((t) => t[0] === key)?.[1];
}

describe("buildArticle (kind:30023)", () => {
  it("produces a NIP-23 addressable event with the required tags", () => {
    const ev = buildArticle("pk", {
      content: "# Hello\nbody",
      title: "My Post",
      summary: "a summary",
      image: "https://x.com/a.png",
      hashtags: ["#Nostr", "ai", " "],
    });
    expect(ev.kind).toBe(30023);
    expect(ev.pubkey).toBe("pk");
    expect(ev.content).toBe("# Hello\nbody");
    expect(tagVal(ev.tags, "title")).toBe("My Post");
    expect(tagVal(ev.tags, "summary")).toBe("a summary");
    expect(tagVal(ev.tags, "image")).toBe("https://x.com/a.png");
    expect(tagVal(ev.tags, "d")).toBeTruthy(); // generated slug
    expect(tagVal(ev.tags, "published_at")).toBeTruthy();
    // hashtags normalized: leading # stripped, lowercased, blanks dropped
    const ts = ev.tags.filter((t) => t[0] === "t").map((t) => t[1]);
    expect(ts).toEqual(["nostr", "ai"]);
  });

  it("generates a fresh slug each call (new article, not an overwrite)", () => {
    const a = buildArticle("pk", { content: "x", title: "t" });
    const b = buildArticle("pk", { content: "x", title: "t" });
    expect(tagVal(a.tags, "d")).not.toBe(tagVal(b.tags, "d"));
  });

  it("respects an explicit slug", () => {
    const ev = buildArticle("pk", { content: "x", title: "t", slug: "my-slug" });
    expect(tagVal(ev.tags, "d")).toBe("my-slug");
  });

  it("omits optional tags when absent", () => {
    const ev = buildArticle("pk", { content: "x", title: "t" });
    expect(tagVal(ev.tags, "summary")).toBeUndefined();
    expect(tagVal(ev.tags, "image")).toBeUndefined();
  });
});
