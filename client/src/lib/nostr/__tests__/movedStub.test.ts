import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import type { NostrEvent } from "@/types/nostr";

// A rotation stub through the real pipeline: it replaces the release at its
// address, is never shelved, records the redirect and makes this device
// forget the stub author's key (soot docs/collab-shared-key.md §2).
const keychain = new Map<string, string>();
vi.mock("@/lib/nostr/secretStore", () => ({
  getSecret: async (k: string) => keychain.get(k) ?? null,
  setSecret: async (k: string, v: string) => void keychain.set(k, v),
  deleteSecret: async (k: string) => void keychain.delete(k),
}));

import { processIncomingEvent, resetEventPipelineCaches } from "../eventPipeline";
import { store, resetAll } from "@/store";
import { login } from "@/store/slices/identitySlice";
import { receiveProjectKey, clearProjectKeySession } from "@/features/music/sharedKey/projectKeys";
import { projectKeyIndexSlot, projectKeySlot } from "@/features/music/sharedKey/projectKeyStore";

const ME = "a".repeat(64);
const WS = "local";
const settle = () => new Promise((res) => setTimeout(res, 10));

const k1 = generateSecretKey();
const K1 = getPublicKey(k1);
const K2 = "f".repeat(64);
let n = 0;

function event(kind: number, tags: string[][], created_at: number): NostrEvent {
  n++;
  return { id: n.toString(16).padStart(64, "0"), pubkey: K1, created_at, kind, tags, content: "", sig: "0".repeat(128) };
}

beforeEach(async () => {
  store.dispatch(resetAll());
  resetEventPipelineCaches();
  clearProjectKeySession();
  keychain.clear();
  store.dispatch(login({ pubkey: ME, signerType: "tauri_keystore" }));
  await receiveProjectKey({ projectPubkey: K1, coord: `33123:${K1}:tapes`, secretKey: k1, sentAt: 1 }, ME);
});

afterEach(() => {
  store.dispatch(resetAll());
});

describe("moved stubs", () => {
  it("replace the release, record the redirect and forget the stub author's key", async () => {
    await processIncomingEvent(
      event(33123, [["d", "tapes"], ["title", "tapes"], ["p", ME, "", "owner"], ["visibility", "private"]], 1000),
      WS,
    );
    expect(store.getState().music.albums[`33123:${K1}:tapes`]).toBeDefined();

    await processIncomingEvent(
      event(33123, [["d", "tapes"], ["title", "tapes"], ["moved", `33123:${K2}:tapes`], ["alt", "this project moved"], ["visibility", "private"], ["p", ME, "", "owner"]], 2000),
      WS,
    );
    await settle();

    const music = store.getState().music;
    expect(music.albums[`33123:${K1}:tapes`]).toBeUndefined();
    expect(music.movedReleases[`33123:${K1}:tapes`]).toEqual({ to: `33123:${K2}:tapes`, at: 2000 });
    expect(music.heldProjectKeys).toEqual({});
    expect(keychain.has(projectKeySlot(ME, K1))).toBe(false);
    const index = JSON.parse(keychain.get(projectKeyIndexSlot(ME))!);
    expect(index.gone[K1]).toBeGreaterThan(0);
  });

  it("an older stub doesn't remove a newer release (someone republished over it)", async () => {
    await processIncomingEvent(event(31683, [["d", "t1"], ["title", "one"], ["imeta", "url https://x/a.mp3", "m audio/mpeg"]], 3000), WS);
    await processIncomingEvent(event(31683, [["d", "t1"], ["title", "one"], ["moved", `31683:${K2}:t1`]], 2000), WS);
    await settle();
    expect(store.getState().music.tracks[`31683:${K1}:t1`]).toBeDefined();
    expect(store.getState().music.heldProjectKeys[K1]).toBeDefined();
  });

  it("a key re-learned after its stub was recorded (reload, no tombstone) is forgotten at once", async () => {
    await processIncomingEvent(
      event(33123, [["d", "tapes"], ["title", "tapes"], ["moved", `33123:${K2}:tapes`], ["p", ME, "", "owner"]], 2000),
      WS,
    );
    await settle();
    expect(store.getState().music.heldProjectKeys).toEqual({});

    // Reload on web: the keychain (session memory) and its tombstone are gone,
    // the stub comes back from IndexedDB, and the old key DM is replayed.
    keychain.clear();
    clearProjectKeySession();
    await receiveProjectKey({ projectPubkey: K1, coord: `33123:${K1}:tapes`, secretKey: k1, sentAt: 1 }, ME);

    expect(store.getState().music.heldProjectKeys).toEqual({});
    expect(keychain.has(projectKeySlot(ME, K1))).toBe(false);
    expect(JSON.parse(keychain.get(projectKeyIndexSlot(ME))!).gone[K1]).toBeGreaterThan(0);
  });
});
