import { describe, it, expect } from "vitest";
import { APP_RELAY } from "../constants";
import {
  gatedSpaceIds,
  gatedTargetRelays,
  isGatedTags,
  resolvePublishTargets,
} from "../gatedTargets";

const spaces = [
  { id: "space-a", hostRelay: "wss://host-a.example", relayUrls: ["wss://mirror-a.example"] },
  { id: "space-b", hostRelay: "wss://host-b.example" },
];

describe("isGatedTags", () => {
  it("is false for public tags", () => {
    expect(isGatedTags([["d", "x"], ["title", "t"]])).toBe(false);
  });
  it("is true for a valued h or visibility tag (any visibility value)", () => {
    expect(isGatedTags([["h", "space-a"]])).toBe(true);
    expect(isGatedTags([["visibility", "private"]])).toBe(true);
    expect(isGatedTags([["visibility", "unlisted"]])).toBe(true);
    expect(isGatedTags([["visibility", "whatever"]])).toBe(true);
  });
  it("ignores value-less tags", () => {
    expect(isGatedTags([["h"], ["visibility"]])).toBe(false);
    expect(isGatedTags([["h"], ["h", "space-a"]])).toBe(true);
  });
});

describe("gatedSpaceIds", () => {
  it("returns every valued h tag once, in order", () => {
    expect(gatedSpaceIds([["h", "b"], ["h", "a"], ["h", "b"], ["h"]])).toEqual(["b", "a"]);
  });
});

describe("gatedTargetRelays", () => {
  it("routes a space-scoped event to the app relay + every listed space's host set", () => {
    expect(gatedTargetRelays([["h", "space-a"], ["h", "space-b"]], spaces)).toEqual([
      APP_RELAY,
      "wss://host-a.example",
      "wss://mirror-a.example",
      "wss://host-b.example",
    ]);
  });
  it("routes a private event, or one whose spaces are unknown, to the app relay only", () => {
    expect(gatedTargetRelays([["visibility", "private"]], spaces)).toEqual([APP_RELAY]);
    expect(gatedTargetRelays([["h", "left-this-space"]], spaces)).toEqual([APP_RELAY]);
  });
  it("never includes a public write relay", () => {
    const out = gatedTargetRelays([["h", "space-a"], ["visibility", "private"]], spaces);
    expect(out).not.toContain("wss://relay.damus.io");
    expect(out).not.toContain("wss://nos.lol");
  });
});

describe("resolvePublishTargets", () => {
  it("leaves explicit targets alone", () => {
    expect(resolvePublishTargets([["h", "space-a"]], ["wss://explicit"], spaces)).toEqual(["wss://explicit"]);
  });
  it("returns undefined (default write relays) for a public event", () => {
    expect(resolvePublishTargets([["d", "x"]], undefined, spaces)).toBeUndefined();
  });
  it("substitutes the gated set when a protected event has no targets", () => {
    expect(resolvePublishTargets([["h", "space-b"]], undefined, spaces)).toEqual([APP_RELAY, "wss://host-b.example"]);
    expect(resolvePublishTargets([["visibility", "unlisted"]], undefined, spaces)).toEqual([APP_RELAY]);
  });
});
