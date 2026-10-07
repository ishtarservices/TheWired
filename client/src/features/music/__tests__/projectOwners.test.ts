import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NostrEvent, UnsignedEvent } from "@/types/nostr";

const keychain = new Map<string, string>();
vi.mock("@/lib/nostr/secretStore", () => ({
  getSecret: async (k: string) => keychain.get(k) ?? null,
  setSecret: async (k: string, v: string) => void keychain.set(k, v),
  deleteSecret: async (k: string) => void keychain.delete(k),
}));
const published: UnsignedEvent[] = [];
vi.mock("@/lib/nostr/publish", () => ({
  signAndPublish: async (unsigned: UnsignedEvent, _relays: unknown, opts?: { signer?: { pubkey: string } }) => {
    expect(opts?.signer?.pubkey).toBe(unsigned.pubkey); // always signed as the project key
    published.push(unsigned);
    return unsigned;
  },
}));
const shared: Array<[string, string]> = [];
vi.mock("../sharedKey/projectKeySender", () => ({
  shareHeldProjectKey: async (projectPubkey: string, to: string) => void shared.push([projectPubkey, to]),
}));

import { store, resetAll } from "@/store";
import { login } from "@/store/slices/identitySlice";
import { createProjectKey, clearProjectKeySession } from "../sharedKey/projectKeys";
import { addProjectOwner } from "../sharedKey/projectOwners";
import { parseAlbumEvent } from "../albumParser";
import { parseTrackEvent } from "../trackParser";

const ME = "a".repeat(64);
const NEW_OWNER = "b".repeat(64);
const CONTRIBUTOR = "c".repeat(64);

function ev(kind: number, pubkey: string, tags: string[][]): NostrEvent {
  return { id: `${kind}${pubkey.slice(0, 6)}${tags[0][1]}`, pubkey, created_at: 1000, kind, tags, content: "", sig: "" };
}

beforeEach(() => {
  store.dispatch(resetAll());
  clearProjectKeySession();
  keychain.clear();
  published.length = 0;
  shared.length = 0;
  store.dispatch(login({ pubkey: ME, signerType: "tauri_keystore" }));
});

describe("addProjectOwner", () => {
  it("adds the owner tag to the project and every key-signed track, then sends the key", async () => {
    const { signer } = await createProjectKey(ME, "tapes");
    const pk = signer.pubkey;
    const visibility = ["visibility", "private"];
    const members = [["p", ME, "", "artist"], ["p", ME, "", "owner"]];
    const album = parseAlbumEvent(ev(33123, pk, [
      ["d", "tapes"], ["title", "tapes"], ["artist", "band"], ...members, visibility,
      ["a", `31683:${pk}:one`], ["a", `31683:${CONTRIBUTOR}:theirs`],
    ]));
    const track = (d: string, author: string) => parseTrackEvent(ev(31683, author, [
      ["d", d], ["title", d], ["artist", "band"], ...members, visibility,
      ["imeta", `url https://x/${d}.mp3`, "m audio/mpeg", `x ${"f".repeat(64)}`],
      ["a", `33123:${pk}:tapes`],
    ]));
    const tracks = {
      [`31683:${pk}:one`]: track("one", pk),
      [`31683:${CONTRIBUTOR}:theirs`]: track("theirs", CONTRIBUTOR),
    };

    await addProjectOwner(album, tracks, NEW_OWNER);

    // The project + its one key-signed track; the contributor's track is theirs.
    expect(published.map((e) => `${e.kind}:${e.tags.find((t) => t[0] === "d")?.[1]}`)).toEqual(["33123:tapes", "31683:one"]);
    for (const e of published) {
      expect(e.pubkey).toBe(pk);
      expect(e.tags).toEqual(expect.arrayContaining([["p", ME, "", "owner"], ["p", NEW_OWNER, "", "owner"], ["visibility", "private"]]));
    }
    // The track keeps its audio imeta (hash included) and back-ref.
    expect(published[1].tags).toEqual(expect.arrayContaining([["a", `33123:${pk}:tapes`]]));
    expect(published[1].tags.find((t) => t[0] === "imeta")).toContain(`x ${"f".repeat(64)}`);
    expect(shared).toEqual([[pk, NEW_OWNER]]);
  });

  it("skips republishing what already names the owner", async () => {
    const { signer } = await createProjectKey(ME, "tapes");
    const pk = signer.pubkey;
    const album = parseAlbumEvent(ev(33123, pk, [["d", "tapes"], ["title", "tapes"], ["p", ME, "", "owner"], ["p", NEW_OWNER, "", "owner"]]));
    await addProjectOwner(album, {}, NEW_OWNER);
    expect(published).toEqual([]);
    expect(shared).toEqual([[pk, NEW_OWNER]]);
  });

  it("refuses without the project key on this device", async () => {
    const album = parseAlbumEvent(ev(33123, "d".repeat(64), [["d", "x"], ["title", "x"], ["p", ME, "", "owner"]]));
    await expect(addProjectOwner(album, {}, NEW_OWNER)).rejects.toThrow(/isn't on this device/);
  });
});
