import { describe, it, expect } from "vitest";
import { PUBLIC_WEB_ORIGIN, publicWebUrl, resolvePublicWebOrigin } from "../publicLinks";
import { buildMusicLink } from "../../features/music/musicLinks";

/**
 * Share links (space invites, music) are opened by people on other devices,
 * so they are built on the public web origin and never on the runtime one,
 * which is `tauri://localhost` in the packaged desktop app.
 */

describe("resolvePublicWebOrigin", () => {
  it("defaults to the public site", () => {
    expect(resolvePublicWebOrigin(undefined)).toBe("https://thewired.app");
    expect(resolvePublicWebOrigin("")).toBe("https://thewired.app");
  });

  it("takes only the origin of an http(s) override", () => {
    expect(resolvePublicWebOrigin("https://staging.thewired.app/")).toBe("https://staging.thewired.app");
    expect(resolvePublicWebOrigin("https://thewired.app/some/path?x=1")).toBe("https://thewired.app");
    expect(resolvePublicWebOrigin("http://localhost:3002")).toBe("http://localhost:3002");
  });

  it("refuses an app-internal or malformed origin", () => {
    expect(resolvePublicWebOrigin("tauri://localhost")).toBe("https://thewired.app");
    expect(resolvePublicWebOrigin("not a url")).toBe("https://thewired.app");
  });
});

describe("publicWebUrl", () => {
  it("joins a path onto the origin", () => {
    expect(publicWebUrl("/invite/AbC123xy", "https://thewired.app")).toBe("https://thewired.app/invite/AbC123xy");
    expect(publicWebUrl("invite/AbC123xy", "https://thewired.app")).toBe("https://thewired.app/invite/AbC123xy");
  });

  it("does not use the page's own origin", () => {
    // jsdom serves the test page from a localhost origin.
    expect(publicWebUrl("/invite/x")).not.toContain(window.location.origin);
    expect(publicWebUrl("/invite/x")).toBe(`${PUBLIC_WEB_ORIGIN}/invite/x`);
  });
});

describe("buildMusicLink", () => {
  const pk = "a".repeat(64);

  it("builds track, album and playlist links on the public origin", () => {
    expect(buildMusicLink(`31683:${pk}:my-track`)).toBe(`${PUBLIC_WEB_ORIGIN}/music/track/${pk}/my-track`);
    expect(buildMusicLink(`33123:${pk}:my-album`)).toBe(`${PUBLIC_WEB_ORIGIN}/music/album/${pk}/my-album`);
    expect(buildMusicLink(`30119:${pk}:mix`)).toBe(`${PUBLIC_WEB_ORIGIN}/music/playlist/${pk}/mix`);
  });

  it("keeps a d-tag that contains colons whole", () => {
    expect(buildMusicLink(`31683:${pk}:a:b`)).toBe(`${PUBLIC_WEB_ORIGIN}/music/track/${pk}/a:b`);
  });
});
