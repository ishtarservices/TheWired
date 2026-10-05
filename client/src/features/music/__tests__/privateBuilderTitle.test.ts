import { describe, it, expect, vi } from "vitest";

// The relay refuses music events without a cleartext `title` tag (audit
// #115). The NIP-44 private builders keep the real title encrypted, so they
// must still emit a placeholder or every private upload is rejected (WIR-158).
vi.mock("@/lib/nostr/nip44", () => ({
  nip44Encrypt: vi.fn(async (_pk: string, plaintext: string) => `enc:${plaintext.length}`),
}));

import {
  buildPrivateTrackEvent,
  buildPrivateAlbumEvent,
  PRIVATE_TRACK_TITLE,
  PRIVATE_ALBUM_TITLE,
} from "../musicEventBuilder";

const ME = "a".repeat(64);

describe("private builders satisfy the relay's title rule", () => {
  it("track: placeholder title tag, real title only in the ciphertext", async () => {
    const ev = await buildPrivateTrackEvent(ME, {
      title: "Secret Song",
      artist: "Me",
      slug: "secret",
      audioUrl: "https://example.com/a.mp3",
    } as Parameters<typeof buildPrivateTrackEvent>[1]);
    expect(ev.tags.find((t) => t[0] === "title")).toEqual(["title", PRIVATE_TRACK_TITLE]);
    expect(ev.tags.find((t) => t[0] === "d")).toEqual(["d", "secret"]);
    expect(ev.tags.find((t) => t[0] === "visibility")).toEqual(["visibility", "private"]);
    expect(JSON.stringify(ev.tags)).not.toContain("Secret Song");
    expect(ev.content.startsWith("enc:")).toBe(true);
  });

  it("album: placeholder title tag, real title only in the ciphertext", async () => {
    const ev = await buildPrivateAlbumEvent(ME, {
      title: "Secret Album",
      artist: "Me",
      slug: "secret-album",
    } as Parameters<typeof buildPrivateAlbumEvent>[1]);
    expect(ev.tags.find((t) => t[0] === "title")).toEqual(["title", PRIVATE_ALBUM_TITLE]);
    expect(JSON.stringify(ev.tags)).not.toContain("Secret Album");
  });
});
