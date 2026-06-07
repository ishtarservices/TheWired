import { describe, it, expect, vi } from "vitest";

// parseProfileContent is pure, but the module imports the DB client at load.
// Mock it so the test never touches Postgres/config.
vi.mock("../../db/connection.js", () => ({ db: {} }));

import { parseProfileContent } from "../profileCacheService.js";

describe("parseProfileContent", () => {
  it("extracts the cached columns, including lud06", () => {
    const p = parseProfileContent(
      JSON.stringify({
        name: "Luna",
        display_name: "Luna V",
        about: "bio",
        picture: "https://p",
        banner: "https://b",
        nip05: "luna@x",
        lud16: "luna@wallet.com",
        lud06: "lnurl1abc",
        website: "https://x",
      }),
    );
    expect(p).not.toBeNull();
    expect(p?.displayName).toBe("Luna V");
    expect(p?.lud16).toBe("luna@wallet.com");
    expect(p?.lud06).toBe("lnurl1abc");
  });

  it("maps lud06 to null when absent or non-string", () => {
    expect(parseProfileContent(JSON.stringify({ name: "Luna" }))?.lud06).toBeNull();
    expect(parseProfileContent(JSON.stringify({ lud06: 123 }))?.lud06).toBeNull();
    expect(parseProfileContent(JSON.stringify({ lud06: "" }))?.lud06).toBeNull();
  });

  it("returns null on invalid JSON", () => {
    expect(parseProfileContent("not json")).toBeNull();
    expect(parseProfileContent("")).toBeNull();
  });

  it("returns null on non-object JSON (primitive / null / array)", () => {
    expect(parseProfileContent('"a string"')).toBeNull();
    expect(parseProfileContent("42")).toBeNull();
    expect(parseProfileContent("null")).toBeNull();
    expect(parseProfileContent('["arr"]')).toBeNull();
  });
});
