import { describe, it, expect } from "vitest";
import { fromHit, handleFor, personSignalLabel, verifierFor } from "../peopleRow";

describe("handleFor", () => {
  it("drops an own-domain handle that just repeats the display name", () => {
    // "gothicmonk@thewired.app" under "Gothic Monk" is the same word twice
    // plus a suffix every row shares — the header (browse) or the domain mark
    // (search) carries verification instead.
    expect(handleFor("gothicmonk@thewired.app", "Gothic Monk")).toBeNull();
    expect(handleFor("LunaVega@thewired.app", "Luna Vega")).toBeNull();
  });

  it("keeps an own-domain handle that differs from the name", () => {
    expect(handleFor("dj_sludge@thewired.app", "Marcus Cole")).toBe("dj_sludge");
  });

  it("keeps a foreign domain in full — that IS the information", () => {
    expect(handleFor("aria@somewhere.else", "Aria Blackwood")).toBe("aria@somewhere.else");
  });

  it("handles absent or malformed nip05 without throwing", () => {
    expect(handleFor(null, "Whoever")).toBeNull();
    expect(handleFor("@thewired.app", "Whoever")).toBe("@thewired.app");
    expect(handleFor("nodomain", "Whoever")).toBe("nodomain");
  });
});

describe("personSignalLabel", () => {
  it("reports recent activity", () => {
    expect(personSignalLabel(4)).toBe("4 notes · 30d");
    expect(personSignalLabel(1)).toBe("1 note · 30d");
  });

  it("says nothing at zero rather than claiming inactivity", () => {
    // A 0 usually means the 30-day window is empty, not that the person is
    // silent — printing "0 notes" would assert something we can't support.
    expect(personSignalLabel(0)).toBeNull();
    expect(personSignalLabel(-1)).toBeNull();
  });
});

describe("verifierFor", () => {
  it("shows nothing in browse — the header already says the list is handles-only", () => {
    expect(verifierFor("lunavega@thewired.app", null, false)).toBeNull();
  });

  it("names the domain in mixed results when the handle line was dropped", () => {
    expect(verifierFor("lunavega@thewired.app", null, true)).toBe("thewired.app");
  });

  it("names the domain when the handle line shows only a local part", () => {
    expect(verifierFor("dj_sludge@thewired.app", "dj_sludge", true)).toBe("thewired.app");
  });

  it("stays quiet when the handle line already prints the full address", () => {
    expect(verifierFor("luna@elsewhere.xyz", "luna@elsewhere.xyz", true)).toBeNull();
  });

  it("has nothing to vouch for a malformed or missing nip05", () => {
    expect(verifierFor(null, null, true)).toBeNull();
    expect(verifierFor("nodomain", "nodomain", true)).toBeNull();
    expect(verifierFor("@thewired.app", "@thewired.app", true)).toBeNull();
  });

  it("lowercases the domain — it is an id, not a name", () => {
    expect(verifierFor("Luna@TheWired.App", null, true)).toBe("thewired.app");
  });
});

describe("fromHit", () => {
  it("never marks a row verified without a handle", () => {
    const row = fromHit({
      pubkey: "a".repeat(64),
      name: "Ghost",
      displayName: null,
      nip05: null,
      about: null,
      picture: null,
      noteCount: 0,
      hasNip05: false,
    });
    expect(row.verified).toBe(false);
    expect(row.handle).toBeNull();
    expect(row.name).toBe("Ghost");
  });
});
