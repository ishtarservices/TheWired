import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { stripMediaGrant } from "@ishtarservices/core";
import { parseContent } from "@/lib/content/parseContent";
import { extractMediaUrls, hasMediaUrls, stripMediaUrls } from "../mediaUrlParser";
import { parseVideoEvent } from "@/features/media/imetaParser";
import { clearMediaGrant, currentGrantExp, ensureMediaGrant } from "../mediaGrant";
import { classifyEventMediaUrl, imetaByUrl, imetaFor } from "../eventMedia";
import type { NostrEvent } from "@/types/nostr";

vi.mock("@/lib/api/nip98", () => ({
  buildNip98Header: vi.fn(async () => "Nostr test"),
  buildAuthHeaders: vi.fn(async () => ({ Authorization: "Nostr test", "X-Wired-Client": "desktop/0.0.0-test (macos)" })),
}));

const OWN = "http://localhost:9080";
const SHA = "ab".repeat(32);
const SHA2 = "cd".repeat(32);
const TOKEN = "v1.pk.1234.deadbeef";
const AUTHOR = "f".repeat(64);

function ev(partial: Partial<NostrEvent>): NostrEvent {
  return {
    id: "1".repeat(64),
    pubkey: AUTHOR,
    created_at: 1,
    kind: 9,
    tags: [],
    content: "",
    sig: "0".repeat(128),
    ...partial,
  };
}

beforeAll(async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).endsWith("/media-grant")) {
        return new Response(JSON.stringify({ data: { token: TOKEN, exp: currentGrantExp() } }), { status: 200 });
      }
      return new Response(null, { status: 404 });
    }),
  );
  expect(await ensureMediaGrant()).toBe(TOKEN);
});

afterAll(() => {
  clearMediaGrant();
  vi.unstubAllGlobals();
});

const spaceA = (content: string, tags: string[][] = []) => ev({ content, tags: [["h", "space-a"], ...tags] });
const publicNote = (content: string, tags: string[][] = []) => ev({ kind: 1, content, tags });

describe("parse chokepoint tokenization", () => {
  it("a space event's own-origin image gets the grant", () => {
    const e = spaceA(`look ${OWN}/${SHA}.png`);
    const seg = parseContent(e.content, undefined, e).find((s) => s.type === "image");
    expect(seg).toMatchObject({ type: "image", url: `${OWN}/${SHA}.png?tk=${encodeURIComponent(TOKEN)}`, gated: true, author: AUTHOR });
  });

  it("a public note's own-origin image gets no token", () => {
    const e = publicNote(`${OWN}/${SHA}.png`);
    const seg = parseContent(e.content, undefined, e).find((s) => s.type === "image");
    expect(seg).toMatchObject({ type: "image", url: `${OWN}/${SHA}.png` });
    expect(seg && "gated" in seg ? seg.gated : undefined).toBeUndefined();
  });

  it("foreign hosts never get a token, even in a space event", () => {
    const e = spaceA(`https://blossom.primal.net/${SHA}.png https://cdn.example.com/cat.jpg`);
    const urls = parseContent(e.content, undefined, e)
      .filter((s) => s.type === "image")
      .map((s) => (s as { url: string }).url);
    expect(urls).toEqual([`https://blossom.primal.net/${SHA}.png`, "https://cdn.example.com/cat.jpg"]);
    for (const u of urls) expect(u).not.toContain("tk=");
  });

  it("content with no event context is never tokenized (DM text, profile bios)", () => {
    const seg = parseContent(`${OWN}/${SHA}.png`).find((s) => s.type === "image");
    expect((seg as { url: string }).url).toBe(`${OWN}/${SHA}.png`);
  });

  it("mediaUrlParser tokenizes the render URL but keeps matchText for stripping", () => {
    const e = spaceA(`hello\n${OWN}/${SHA}.jpg`);
    const [m] = extractMediaUrls(e.content, e);
    expect(m.url).toContain("tk=");
    expect(m.matchText).toBe(`${OWN}/${SHA}.jpg`);
    expect(m.gated).toBe(true);
    expect(stripMediaUrls(e.content, e)).toBe("hello");
  });

  it("stripMediaGrant gives back the shareable URL for copy / href", () => {
    const e = spaceA(`${OWN}/${SHA}.png`);
    const [m] = extractMediaUrls(e.content, e);
    expect(stripMediaGrant(m.url)).toBe(`${OWN}/${SHA}.png`);
  });

  it("video events tokenize variants, fallback and thumbnail only when h-tagged", () => {
    const tags = [
      ["imeta", `url ${OWN}/${SHA}.mp4`, "m video/mp4", `fallback ${OWN}/${SHA2}.mp4`],
      ["thumb", `${OWN}/${SHA2}.jpg`],
    ];
    const gated = parseVideoEvent(ev({ kind: 21, tags: [["h", "space-a"], ...tags] }));
    expect(gated.variants[0].url).toContain("tk=");
    expect(gated.variants[0].fallback).toContain("tk=");
    expect(gated.thumbnail).toContain("tk=");
    const open = parseVideoEvent(ev({ kind: 21, tags }));
    expect(open.variants[0].url).toBe(`${OWN}/${SHA}.mp4`);
    expect(open.thumbnail).toBe(`${OWN}/${SHA2}.jpg`);
  });
});

describe("extensionless blob classification", () => {
  const url = `${OWN}/${SHA}`;

  it.each([
    ["image/png", "image"],
    ["video/mp4", "video"],
    ["audio/mpeg", "audio"],
  ])("imeta m %s renders as %s", (mime, kind) => {
    const e = publicNote(url, [["imeta", `url ${url}`, `m ${mime}`]]);
    const seg = parseContent(e.content, undefined, e)[0];
    expect(seg.type).toBe(kind);
    expect(extractMediaUrls(e.content, e)[0]?.type).toBe(kind);
  });

  it("a soot-style extensionless image with imeta is gallery media, not a link", () => {
    const e = publicNote(`caption ${url}`, [["imeta", `url ${url}`, "m image/jpeg", `x ${SHA}`]]);
    expect(hasMediaUrls(e.content, e)).toBe(true);
    expect(stripMediaUrls(e.content, e)).toBe("caption");
  });

  it("application/pdf becomes a file segment", () => {
    const e = publicNote(url, [["imeta", `url ${url}`, "m application/pdf"]]);
    expect(parseContent(e.content, undefined, e)[0]).toMatchObject({ type: "file", filename: `${SHA}.pdf` });
  });

  it("without imeta it is a probe-pending blob segment (not a bare url)", () => {
    const e = publicNote(url);
    expect(parseContent(e.content, undefined, e)[0]).toMatchObject({ type: "blob", url });
    expect(extractMediaUrls(e.content, e)).toEqual([]);
  });

  it("carries every imeta fallback for the error chain", () => {
    const tags = [["imeta", `url ${url}`, "m image/png", "fallback https://a.example/x", "fallback https://b.example/y"]];
    expect(imetaFor(imetaByUrl(tags), url)?.fallbacks).toEqual(["https://a.example/x", "https://b.example/y"]);
    const e = publicNote(url, tags);
    expect(parseContent(e.content, undefined, e)[0]).toMatchObject({
      fallbacks: ["https://a.example/x", "https://b.example/y"],
    });
  });

  it("extensions win over imeta; unrelated URLs stay unclassified", () => {
    expect(classifyEventMediaUrl(`${OWN}/${SHA}.mp4`, { mime: "image/png", fallbacks: [] })).toBe("video");
    expect(classifyEventMediaUrl("https://example.com/page", { mime: "image/png", fallbacks: [] })).toBeNull();
  });
});

describe("imeta layout hints", () => {
  const url = "https://cdn.example.com/clip.mp4";
  const poster = "https://cdn.example.com/clip.jpg";
  const tags = [["imeta", `url ${url}`, "m video/mp4", "dim 720x1280", `image ${poster}`]];

  it("imetaByUrl reads dim and an http(s) poster", () => {
    expect(imetaFor(imetaByUrl(tags), url)).toMatchObject({ dim: "720x1280", poster });
    const unsafe = imetaByUrl([["imeta", `url ${url}`, "image javascript:alert(1)"]]);
    expect(imetaFor(unsafe, url)?.poster).toBeUndefined();
  });

  it("parseContent and extractMediaUrls carry them on the media", () => {
    const e = publicNote(`clip ${url}`, tags);
    expect(parseContent(e.content, undefined, e).find((s) => s.type === "video")).toMatchObject({
      dim: "720x1280",
      poster,
    });
    expect(extractMediaUrls(e.content, e)[0]).toMatchObject({ dim: "720x1280", poster });
  });
});
