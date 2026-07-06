import type { NostrEvent } from "@thewired/shared-types";

import { parseProfile, profileDisplayName } from "../profiles";
import { splitNoteContent } from "../noteContent";

function kind0(content: string): NostrEvent {
  return { id: "i", pubkey: "pk", created_at: 42, kind: 0, tags: [], content, sig: "s" };
}

// The parser itself is single-sourced (and fully tested) in @thewired/core —
// this just proves the re-export shim resolves the core package under Metro/jest.
describe("profiles shim (@thewired/core)", () => {
  it("parses via the core hardened parser and stamps created_at", () => {
    const profile = parseProfile(
      kind0(JSON.stringify({ name: "alice", about: "hi", picture: "https://x/p.png" })),
    );
    expect(profile).toEqual({
      name: "alice",
      about: "hi",
      picture: "https://x/p.png",
      created_at: 42,
    });
    expect(parseProfile(kind0("not json"))).toBeNull();
  });

  it("re-exports profileDisplayName", () => {
    const pk = "abcdef0123456789";
    expect(profileDisplayName({ display_name: "A", name: "b" }, pk)).toBe("A");
    expect(profileDisplayName(undefined, pk)).toBe("abcdef01…");
  });
});

describe("splitNoteContent", () => {
  it("extracts image urls and cleans the text", () => {
    const { text, images } = splitNoteContent(
      "look https://x.com/a.png at this https://x.com/b.jpg?w=1 wow",
    );
    expect(images).toEqual(["https://x.com/a.png", "https://x.com/b.jpg?w=1"]);
    expect(text).toBe("look at this wow");
  });

  it("leaves plain notes untouched", () => {
    const { text, images } = splitNoteContent("just words https://example.com/page");
    expect(images).toEqual([]);
    expect(text).toBe("just words https://example.com/page");
  });
});
