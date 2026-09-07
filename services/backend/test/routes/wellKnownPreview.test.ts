/**
 * Tests for the universal-links association files (backend brief P1.7) and the
 * server-rendered OG share pages (P1.9). Non-public events must render the same
 * generic page as missing ones — no metadata leak, no existence oracle.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestServer, closeTestServer } from "../helpers/testServer.js";
import { db } from "../../src/db/connection.js";
import { cachedProfiles } from "../../src/db/schema/profiles.js";
import {
  ensureRelayEventsTable,
  insertMusicEvent,
  deleteRelayEventsBySlugPrefix,
} from "../helpers/relayEvents.js";
import { LUNA } from "../helpers/testUsers.js";

let server: FastifyInstance;
const SLUG = "wkprev"; // file-unique slug prefix

beforeAll(async () => {
  server = await buildTestServer();
  await ensureRelayEventsTable();
});

beforeEach(async () => {
  await insertMusicEvent({
    kind: 31683, pubkey: LUNA.pubkey, slug: `${SLUG}-pub`,
    title: "Neon Rain", artist: "Luna Vega",
    imageUrl: "https://cdn.example.com/cover.jpg",
  });
  await insertMusicEvent({
    kind: 31683, pubkey: LUNA.pubkey, slug: `${SLUG}-priv`,
    title: "Secret Demo", artist: "Luna Vega", visibility: "private",
  });
  await insertMusicEvent({
    kind: 31683, pubkey: LUNA.pubkey, slug: `${SLUG}-space`,
    title: "Space Only", artist: "Luna Vega", hTag: "wk-space",
  });
  await insertMusicEvent({
    kind: 31683, pubkey: LUNA.pubkey, slug: `${SLUG}-xss`,
    title: `<script>alert(1)</script>`, artist: `"><img src=x>`,
  });
  await insertMusicEvent({
    kind: 33123, pubkey: LUNA.pubkey, slug: `${SLUG}-album`,
    title: "First Light", artist: "Luna Vega",
  });
});

afterAll(async () => {
  await deleteRelayEventsBySlugPrefix(SLUG);
  await closeTestServer();
});

describe("GET /.well-known/apple-app-site-association", () => {
  it("serves JSON listing the soot appID and deep-link paths", async () => {
    const res = await server.inject({
      method: "GET", url: "/.well-known/apple-app-site-association",
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");

    const body = res.json();
    const detail = body.applinks.details[0];
    expect(detail.appIDs).toContain("53RG2QV7HT.app.soot.mobile");
    const patterns = detail.components.map((c: Record<string, string>) => c["/"]);
    expect(patterns).toContain("/music/*");
    expect(patterns).toContain("/profile/*");
    expect(patterns).toContain("/npub1*");
  });
});

describe("GET /.well-known/assetlinks.json", () => {
  it("serves an empty statement list until a cert fingerprint is configured", async () => {
    const res = await server.inject({ method: "GET", url: "/.well-known/assetlinks.json" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.json()).toEqual([]);
  });
});

describe("GET /music/:type/:pubkey/:slug — OG share pages", () => {
  it("renders og metadata for a public track", async () => {
    const res = await server.inject({
      method: "GET", url: `/music/track/${LUNA.pubkey}/${SLUG}-pub`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.payload).toContain(
      '<meta property="og:title" content="Neon Rain — Luna Vega">',
    );
    expect(res.payload).toContain(
      '<meta property="og:image" content="https://cdn.example.com/cover.jpg">',
    );
    expect(res.payload).toContain('<meta property="og:type" content="music.song">');
  });

  it("renders og metadata for a public album", async () => {
    const res = await server.inject({
      method: "GET", url: `/music/album/${LUNA.pubkey}/${SLUG}-album`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain('content="First Light — Luna Vega"');
    expect(res.payload).toContain('<meta property="og:type" content="music.album">');
  });

  it("leaks nothing for a private track and is indistinguishable from missing", async () => {
    const priv = await server.inject({
      method: "GET", url: `/music/track/${LUNA.pubkey}/${SLUG}-priv`,
    });
    const missing = await server.inject({
      method: "GET", url: `/music/track/${LUNA.pubkey}/${SLUG}-does-not-exist`,
    });
    expect(priv.statusCode).toBe(200);
    expect(priv.payload).not.toContain("Secret Demo");
    expect(priv.payload).toContain('<meta property="og:title" content="The Wired">');
    // Same generic body modulo the canonical URL → no existence oracle.
    expect(priv.payload.replace(/wkprev-[a-z-]+/g, "X")).toBe(
      missing.payload.replace(/wkprev-[a-z-]+/g, "X"),
    );
  });

  it("leaks nothing for a space-scoped track", async () => {
    const res = await server.inject({
      method: "GET", url: `/music/track/${LUNA.pubkey}/${SLUG}-space`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload).not.toContain("Space Only");
  });

  it("escapes HTML in event-controlled metadata", async () => {
    const res = await server.inject({
      method: "GET", url: `/music/track/${LUNA.pubkey}/${SLUG}-xss`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload).not.toContain("<script>alert(1)</script>");
    expect(res.payload).not.toContain('"><img src=x>');
    expect(res.payload).toContain("&lt;script&gt;");
  });
});

describe("GET /profile/:pubkey — OG share page", () => {
  it("renders the cached profile name and picture", async () => {
    await db.insert(cachedProfiles).values({
      pubkey: LUNA.pubkey,
      name: "luna",
      displayName: "Luna Vega",
      picture: "https://cdn.example.com/luna.jpg",
      fetchedAt: Date.now(),
    });

    const res = await server.inject({
      method: "GET", url: `/profile/${LUNA.pubkey}?section=music`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain('<meta property="og:title" content="Luna Vega">');
    expect(res.payload).toContain("Music by Luna Vega on The Wired");
    expect(res.payload).toContain('https://cdn.example.com/luna.jpg');
  });

  it("?section=music lists only the public releases, each linking to its share page", async () => {
    const res = await server.inject({
      method: "GET", url: `/profile/${LUNA.pubkey}?section=music`,
    });
    expect(res.statusCode).toBe(200);
    // Public track + album, linked to their own OG pages.
    expect(res.payload).toContain(`href="/music/track/${LUNA.pubkey}/${SLUG}-pub"`);
    expect(res.payload).toContain("Neon Rain");
    expect(res.payload).toContain(`href="/music/album/${LUNA.pubkey}/${SLUG}-album"`);
    expect(res.payload).toContain("First Light");
    // Private and space-scoped releases never appear — not even as links.
    expect(res.payload).not.toContain("Secret Demo");
    expect(res.payload).not.toContain(`${SLUG}-priv`);
    expect(res.payload).not.toContain("Space Only");
    expect(res.payload).not.toContain(`${SLUG}-space`);
    // Event-controlled titles are escaped in the list too.
    expect(res.payload).not.toContain("<script>alert(1)</script>");
    expect(res.payload).toContain("&lt;script&gt;");
    // Counts ride the description so the unfurl says what's there.
    expect(res.payload).toMatch(/Music by .* on The Wired · \d+ tracks · 1 album/);
  });

  it("?section=music for an artist with nothing public says so, leaks nothing", async () => {
    const res = await server.inject({
      method: "GET", url: `/profile/${"b".repeat(64)}?section=music`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain("Nothing public here yet.");
    expect(res.payload).not.toContain("wkprev-");
  });

  it("tells a phone to get soot (or open it), and a desktop browser to download The Wired", async () => {
    const path = `/profile/${LUNA.pubkey}?section=music`;
    const iphone = await server.inject({
      method: "GET", url: path,
      headers: { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) Safari/605.1.15" },
    });
    expect(iphone.headers["vary"]).toContain("User-Agent");
    expect(iphone.payload).toContain("Get soot for iPhone");
    expect(iphone.payload).toContain(`href="soot://profile/${LUNA.pubkey}?section=music"`);
    expect(iphone.payload).not.toContain("Download The Wired");

    const android = await server.inject({
      method: "GET", url: path,
      headers: { "user-agent": "Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/128 Mobile" },
    });
    expect(android.payload).toContain("Get soot for Android");

    const mac = await server.inject({
      method: "GET", url: path,
      headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) Chrome/128" },
    });
    expect(mac.payload).toContain("Download The Wired for desktop");
    expect(mac.payload).toContain("https://thewired.app/#download");
    expect(mac.payload).not.toContain("soot://");
  });

  it("falls back to a truncated pubkey for unknown profiles", async () => {
    const res = await server.inject({ method: "GET", url: `/profile/${"a".repeat(64)}` });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain("aaaaaaaa…aaaa");
  });
});
