import { describe, it, expect } from "vitest";
import { buildArticle, articleSlugFromTitle } from "../eventBuilder";

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

  it("derives a kebab-case slug from the title (no longer the old ai- prefix)", () => {
    const ev = buildArticle("pk", { content: "x", title: "Hello, World!" });
    expect(tagVal(ev.tags, "d")).toMatch(/^hello-world-[a-z0-9]{6}$/);
  });

  it("is public by default — no h/channel tags", () => {
    const ev = buildArticle("pk", { content: "x", title: "t" });
    expect(ev.tags.some((t) => t[0] === "h")).toBe(false);
    expect(ev.tags.some((t) => t[0] === "channel")).toBe(false);
  });
});

describe("buildArticle — space-exclusive scoping", () => {
  it("adds an h tag for the space when spaceId is given", () => {
    const ev = buildArticle("pk", { content: "x", title: "t", spaceId: "space-1" });
    expect(tagVal(ev.tags, "h")).toBe("space-1");
  });

  it("adds a channel tag only alongside a space", () => {
    const ev = buildArticle("pk", {
      content: "x",
      title: "t",
      spaceId: "space-1",
      channelId: "chan-9",
    });
    expect(tagVal(ev.tags, "channel")).toBe("chan-9");
  });

  it("ignores channelId when no space is set (no leak of a bare channel tag)", () => {
    const ev = buildArticle("pk", { content: "x", title: "t", channelId: "chan-9" });
    expect(ev.tags.some((t) => t[0] === "channel")).toBe(false);
    expect(ev.tags.some((t) => t[0] === "h")).toBe(false);
  });
});

describe("buildArticle — editing preserves address + publish date", () => {
  it("keeps the d tag and published_at when editing (only created_at advances)", () => {
    const ev = buildArticle("pk", {
      content: "edited body",
      title: "Edited",
      slug: "my-slug",
      publishedAt: 1000,
    });
    expect(tagVal(ev.tags, "d")).toBe("my-slug");
    expect(tagVal(ev.tags, "published_at")).toBe("1000");
    expect(ev.created_at).toBeGreaterThan(1000);
  });
});

describe("articleSlugFromTitle", () => {
  it("kebab-cases and strips punctuation", () => {
    expect(articleSlugFromTitle("My First Post!!!")).toMatch(/^my-first-post-[a-z0-9]{6}$/);
  });

  it("strips accents/unicode to ASCII", () => {
    expect(articleSlugFromTitle("Café Déjà Vu")).toMatch(/^cafe-deja-vu-[a-z0-9]{6}$/);
  });

  it("falls back to a generated slug for emoji-only / blank titles", () => {
    expect(articleSlugFromTitle("🎉🎉🎉")).toMatch(/^article-[a-z0-9]+-[a-z0-9]{6}$/);
    expect(articleSlugFromTitle("   ")).toMatch(/^article-[a-z0-9]+-[a-z0-9]{6}$/);
  });

  it("caps the base length for very long titles", () => {
    const slug = articleSlugFromTitle("word ".repeat(50));
    const base = slug.replace(/-[a-z0-9]{6}$/, "");
    expect(base.length).toBeLessThanOrEqual(60);
  });

  it("produces unique slugs for the same title", () => {
    expect(articleSlugFromTitle("Same Title")).not.toBe(articleSlugFromTitle("Same Title"));
  });
});
