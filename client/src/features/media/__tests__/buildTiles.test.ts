import { describe, it, expect } from "vitest";
import { buildTiles } from "../buildTiles";
import type { VoiceParticipant } from "@/types/calling";

const ME = "f".repeat(64);
const A = "a".repeat(64);
const B = "b".repeat(64);

function participant(pubkey: string, over: Partial<VoiceParticipant> = {}): VoiceParticipant {
  return {
    pubkey,
    displayName: pubkey.slice(0, 4),
    isSpeaking: false,
    isMuted: false,
    isDeafened: false,
    hasVideo: false,
    isScreenSharing: false,
    connectionQuality: "good",
    handRaised: false,
    audioLevel: 0,
    ...over,
  };
}

describe("buildTiles — encryption flag", () => {
  it("carries the local and per-participant encrypted state onto every tile", () => {
    const tiles = buildTiles({
      myPubkey: ME,
      local: { muted: false, videoEnabled: false, screenSharing: true, encrypted: true },
      participants: {
        [A]: participant(A, { encrypted: true, isScreenSharing: true }),
        [B]: participant(B, { encrypted: false }),
      },
      order: [A, B],
      activeSpeakers: [],
    });
    const byId = Object.fromEntries(tiles.map((t) => [t.id, t.encrypted]));
    expect(byId[`${ME}:camera`]).toBe(true);
    expect(byId[`${ME}:screenshare`]).toBe(true);
    expect(byId[`${A}:camera`]).toBe(true);
    expect(byId[`${A}:screenshare`]).toBe(true);
    expect(byId[`${B}:camera`]).toBe(false);
  });

  it("leaves the flag undefined when nothing is known yet", () => {
    const tiles = buildTiles({
      myPubkey: ME,
      local: { muted: false, videoEnabled: false, screenSharing: false },
      participants: { [A]: participant(A) },
      order: [A],
      activeSpeakers: [],
    });
    expect(tiles.every((t) => t.encrypted === undefined)).toBe(true);
  });
});
