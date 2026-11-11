import { describe, it, expect } from "vitest";
import type { Space } from "@/types/space";
import { spaceVisibility } from "../spaceVisibility";

const base: Space = {
  id: "s",
  name: "S",
  hostRelay: "wss://h.example",
  mode: "read-write",
  isPrivate: false,
  adminPubkeys: [],
  memberPubkeys: [],
  feedPubkeys: [],
  creatorPubkey: "",
  createdAt: 0,
};

describe("spaceVisibility", () => {
  it("labels an unlisted platform space as invite-only, never 'Public'", () => {
    expect(spaceVisibility({ ...base, listed: false })).toEqual({ label: "Unlisted · invite only", open: false });
    expect(spaceVisibility({ ...base, spaceType: "decentralized-alite", listed: false })?.label).toBe(
      "Unlisted · invite only",
    );
  });

  it("labels a listed platform space as listed in Discover", () => {
    expect(spaceVisibility({ ...base, listed: true })).toEqual({ label: "Listed in Discover", open: true });
  });

  it("shows nothing for a platform space whose listing isn't known yet", () => {
    expect(spaceVisibility(base)).toBeNull();
  });

  it("keeps Public / Private for NIP-29-native groups", () => {
    expect(spaceVisibility({ ...base, spaceType: "nip29-native" })?.label).toBe("Public");
    expect(spaceVisibility({ ...base, spaceType: "nip29-native", isPrivate: true })?.label).toBe("Private");
  });
});
