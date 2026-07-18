import { resolveAudioSource, toTrack } from "../audioSource";
import { TrackType } from "react-native-track-player";
import type { MusicItem } from "@/screens/spaces/musicEventParser";
import type { NostrEvent } from "@thewired/shared-types";

const ev: NostrEvent = {
  id: "e1",
  pubkey: "p".repeat(64),
  created_at: 1,
  kind: 31683,
  tags: [],
  content: "",
  sig: "",
};

const track = (over: Partial<MusicItem> = {}): MusicItem => ({
  id: "31683:pk:t",
  event: ev,
  kind: "track",
  addressableId: "31683:pk:t",
  title: "Signal",
  artist: "Lain",
  artwork: "https://cdn.x/art.jpg",
  audioUrl: "https://cdn.x/a.mp3",
  visibility: "public",
  artistPubkeys: [],
  durationSec: 212,
  ...over,
});

describe("resolveAudioSource", () => {
  it("returns the direct url with TrackType.Default", async () => {
    await expect(resolveAudioSource(track())).resolves.toEqual({
      url: "https://cdn.x/a.mp3",
      type: TrackType.Default,
    });
  });

  it("throws for a track with no audio url", async () => {
    await expect(resolveAudioSource(track({ audioUrl: null }))).rejects.toThrow();
  });

  it("throws for a private track", async () => {
    await expect(
      resolveAudioSource(track({ visibility: "private" })),
    ).rejects.toThrow();
  });

  it("throws for an album", async () => {
    await expect(
      resolveAudioSource(track({ kind: "album", audioUrl: null })),
    ).rejects.toThrow();
  });
});

describe("toTrack", () => {
  it("builds an RNTP track with id=addressableId and sanitized artwork", async () => {
    const t = await toTrack(track());
    expect(t).toMatchObject({
      id: "31683:pk:t",
      url: "https://cdn.x/a.mp3",
      type: TrackType.Default,
      title: "Signal",
      artist: "Lain",
      artwork: "https://cdn.x/art.jpg",
      duration: 212,
    });
  });

  it("drops a non-http artwork url", async () => {
    const t = await toTrack(track({ artwork: "javascript:alert(1)" }));
    expect(t.artwork).toBeUndefined();
  });

  it("omits artist when absent", async () => {
    const t = await toTrack(track({ artist: null }));
    expect(t.artist).toBeUndefined();
  });
});
