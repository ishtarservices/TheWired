import type { NostrEvent } from "@thewired/shared-types";

import { parseProfile, profileDisplayName } from "../profiles";
import { splitNoteContent } from "../noteContent";

function kind0(content: string): NostrEvent {
  return { id: "i", pubkey: "pk", created_at: 42, kind: 0, tags: [], content, sig: "s" };
}

describe("parseProfile", () => {
  it("parses string fields and stamps created_at", () => {
    const profile = parseProfile(
      kind0(JSON.stringify({ name: "alice", about: "hi", picture: "https://x/p.png" })),
    );
    expect(profile).toEqual({
      name: "alice",
      about: "hi",
      picture: "https://x/p.png",
      created_at: 42,
    });
  });

  it("rejects non-kind-0, bad JSON, and non-object content", () => {
    expect(parseProfile({ ...kind0("{}"), kind: 1 })).toBeNull();
    expect(parseProfile(kind0("not json"))).toBeNull();
    expect(parseProfile(kind0('"a string"'))).toBeNull();
    expect(parseProfile(kind0("[1,2]"))).toBeNull();
  });

  it("drops non-string values and dangerous keys", () => {
    const profile = parseProfile(
      kind0(JSON.stringify({ name: 42, about: "ok", __proto__: { hacked: true } })),
    );
    expect(profile?.name).toBeUndefined();
    expect(profile?.about).toBe("ok");
    expect(({} as Record<string, unknown>).hacked).toBeUndefined();
  });
});

describe("profileDisplayName", () => {
  it("prefers display_name, then name, then shortened pubkey", () => {
    const pk = "abcdef0123456789";
    expect(profileDisplayName({ display_name: "A", name: "b", created_at: 0 }, pk)).toBe("A");
    expect(profileDisplayName({ name: "b", created_at: 0 }, pk)).toBe("b");
    expect(profileDisplayName(undefined, pk)).toBe("abcdef01…");
    expect(profileDisplayName({ display_name: "  ", created_at: 0 }, pk)).toBe("abcdef01…");
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
