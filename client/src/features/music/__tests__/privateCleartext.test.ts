import { describe, it, expect } from "vitest";
import type { NostrEvent } from "@/types/nostr";
import { parsePrivateTrackEvent } from "../trackParser";
import { parsePrivateAlbumEvent } from "../albumParser";
import { looksLikeNip44 } from "../nip44Shape";

const OWNER = "b".repeat(64);
const VIEWER = "c".repeat(64);

function ev(kind: number, content: string): NostrEvent {
  return {
    id: "1".repeat(64),
    pubkey: OWNER,
    created_at: 1_700_000_000,
    kind,
    tags: [
      ["d", "basement"],
      ["title", "Basement Tapes"],
      ["artist", "Spiral"],
      ["visibility", "private"],
      ["p", VIEWER, "", "collaborator"],
    ],
    content,
    sig: "0".repeat(128),
  };
}

describe("soot private releases with plain-text content", () => {
  it("parse from cleartext tags instead of failing a decrypt", async () => {
    const album = await parsePrivateAlbumEvent(ev(33123, "recorded live, one take"), VIEWER);
    expect(album?.title).toBe("Basement Tapes");
    expect(album?.visibility).toBe("private");
    const track = await parsePrivateTrackEvent(ev(31683, "demo, rough mix"), VIEWER);
    expect(track?.title).toBe("Basement Tapes");
  });

  it("looksLikeNip44 rejects prose and accepts the v2 payload shape", () => {
    expect(looksLikeNip44("recorded live, one take")).toBe(false);
    expect(looksLikeNip44("A".repeat(132))).toBe(false); // version byte 0x00
    expect(looksLikeNip44("AgAA" + "A".repeat(128))).toBe(true);
  });
});
