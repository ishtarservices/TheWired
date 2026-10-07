import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import type { NostrEvent } from "@/types/nostr";

// The kind-20017 key DM through the real pipeline (validate -> dedup -> verify
// (globally mocked) -> decrypt queue -> handleGiftWrap); only the NIP-44 unwrap
// and the keychain are stubbed.
const mockUnwrap = vi.fn();
vi.mock("@/lib/nostr/giftWrap", () => ({
  unwrapGiftWrap: (...a: unknown[]) => mockUnwrap(...a),
}));
const keychain = new Map<string, string>();
let persistent = true;
vi.mock("@/lib/nostr/secretStore", () => ({
  isSecretPersistEnabled: () => persistent,
  getSecret: async (k: string) => keychain.get(k) ?? null,
  setSecret: async (k: string, v: string) => void keychain.set(k, v),
  deleteSecret: async (k: string) => void keychain.delete(k),
}));

import { processIncomingEvent, resetEventPipelineCaches } from "../eventPipeline";
import { store, resetAll } from "@/store";
import { login, setMuteList } from "@/store/slices/identitySlice";
import { KIND_DM_PROJECT_KEY, buildProjectKeyDMContent } from "@/features/music/sharedKey/projectKeyDM";
import { getProjectSigner, clearProjectKeySession } from "@/features/music/sharedKey/projectKeys";
import { projectKeySlot } from "@/features/music/sharedKey/projectKeyStore";

const WS = "wss://relay.example";
const ME = "a".repeat(64);
const PARTNER = "b".repeat(64);
const hex64 = (n: number) => n.toString(16).padStart(64, "0");

let wrapCounter = 500;
function wrap(): NostrEvent {
  const id = ++wrapCounter;
  return {
    id: hex64(id),
    pubkey: hex64(0xbeef + id),
    created_at: Math.floor(Date.now() / 1000) - 3600,
    kind: 1059,
    tags: [["p", ME]],
    content: "ciphertext",
    sig: "0".repeat(128),
  };
}

const settle = () => new Promise((res) => setTimeout(res, 10));

async function deliverKey(content: string, sender = PARTNER, w = wrap()) {
  mockUnwrap.mockResolvedValueOnce({
    sender,
    content,
    tags: [["p", ME]],
    createdAt: Math.floor(Date.now() / 1000) - 60,
    wrapId: w.id,
    rumorId: hex64(0xf000 + wrapCounter),
    kind: KIND_DM_PROJECT_KEY,
  });
  await processIncomingEvent(w, WS);
  await settle();
  return w;
}

beforeEach(() => {
  store.dispatch(resetAll());
  resetEventPipelineCaches();
  clearProjectKeySession();
  keychain.clear();
  persistent = true;
  mockUnwrap.mockReset();
  store.dispatch(login({ pubkey: ME, signerType: "tauri_keystore" }));
});

afterEach(() => {
  store.dispatch(resetAll());
});

describe("project key DM through the pipeline", () => {
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);
  const coord = `33123:${pk}:basement-tapes`;

  it("unwraps with kind 20017 accepted", async () => {
    await deliverKey(buildProjectKeyDMContent(coord, sk));
    expect(mockUnwrap.mock.calls[0][1]).toMatchObject({ acceptKinds: expect.arrayContaining([14, KIND_DM_PROJECT_KEY]) });
  });

  it("stores the key in the keychain and only the coordinate in Redux", async () => {
    const w = await deliverKey(buildProjectKeyDMContent(coord, sk));

    expect(keychain.has(projectKeySlot(ME, pk))).toBe(true);
    expect(store.getState().music.heldProjectKeys).toEqual({ [pk]: coord });
    // Never a chat bubble, never in the DM slice beyond the processed wrap id.
    const dm = store.getState().dm;
    expect(Object.values(dm.messages).flat()).toHaveLength(0);
    expect(JSON.stringify(dm)).not.toContain("nsec1");
    expect(dm.processedWrapIdSet[w.id]).toBe(true);

    const signer = await getProjectSigner(pk);
    expect(signer?.pubkey).toBe(pk);
  });

  it("drops a key from a blocked sender before parsing", async () => {
    store.dispatch(setMuteList({ mutes: [{ type: "pubkey", value: PARTNER }], createdAt: 1 }));
    await deliverKey(buildProjectKeyDMContent(coord, sk));
    expect(keychain.size).toBe(0);
    expect(store.getState().music.heldProjectKeys).toEqual({});
  });

  it("drops an invalid key DM and marks the wrap processed", async () => {
    const content = buildProjectKeyDMContent(coord, generateSecretKey()); // nsec != coord pubkey
    const w = await deliverKey(content);
    expect(keychain.size).toBe(0);
    expect(store.getState().music.heldProjectKeys).toEqual({});
    expect(store.getState().dm.processedWrapIdSet[w.id]).toBe(true);
  });

  it("web session memory: the wrap stays unprocessed so a replay after reload restores the key", async () => {
    persistent = false;
    const w = await deliverKey(buildProjectKeyDMContent(coord, sk));
    expect(store.getState().dm.processedWrapIdSet[w.id]).toBeUndefined();

    // Reload: session secrets and Redux are gone; the relay replays the wrap.
    keychain.clear();
    store.dispatch(resetAll());
    resetEventPipelineCaches();
    clearProjectKeySession();
    store.dispatch(login({ pubkey: ME, signerType: "nip07" }));
    await deliverKey(buildProjectKeyDMContent(coord, sk), PARTNER, w);

    expect(store.getState().music.heldProjectKeys).toEqual({ [pk]: coord });
  });

  it("a replay of an already-processed wrap is still checked (a lost key comes back)", async () => {
    const w = await deliverKey(buildProjectKeyDMContent(coord, sk));
    expect(store.getState().dm.processedWrapIdSet[w.id]).toBe(true);
    keychain.clear();
    resetEventPipelineCaches();
    clearProjectKeySession();
    await deliverKey(buildProjectKeyDMContent(coord, sk), PARTNER, w);
    expect(keychain.has(projectKeySlot(ME, pk))).toBe(true);
  });
});
