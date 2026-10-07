import { describe, it, expect, beforeEach, vi } from "vitest";
import { getPublicKey } from "nostr-tools/pure";

const keychain = new Map<string, string>();
vi.mock("@/lib/nostr/secretStore", () => ({
  getSecret: async (k: string) => keychain.get(k) ?? null,
  setSecret: async (k: string, v: string) => void keychain.set(k, v),
  deleteSecret: async (k: string) => void keychain.delete(k),
}));
const published: Array<{ event: { kind: number; pubkey: string; tags: string[][] }; relays: string[] }> = [];
vi.mock("@/lib/nostr/dmRelayList", () => ({
  getDMRelaysForPublish: async () => ["wss://inbox.example"],
  getOwnDMRelays: () => ["wss://mine.example"],
  fallbackDMRelays: () => ["wss://fallback.example"],
}));
const rumors: Array<{ kind: number; tags: string[][]; content: string }> = [];
vi.mock("@/lib/nostr/giftWrap", () => ({
  buildRumor: async (pubkey: string, to: string, content: string, _extra: unknown, opts: { kind: number }) => {
    const r = { id: "r", pubkey, created_at: 1, kind: opts.kind, tags: [["p", to]], content };
    rumors.push(r);
    return r;
  },
  createGiftWrappedDM: async () => ({ wrap: { kind: 1059, pubkey: "x", tags: [["p", "them"]] }, rumorId: "r" }),
  createSelfWrap: async () => ({ wrap: { kind: 1059, pubkey: "x", tags: [["p", "me"]] }, rumorId: "r" }),
}));

import { store, resetAll } from "@/store";
import { login } from "@/store/slices/identitySlice";
import { createProjectKey, clearProjectKeySession } from "../sharedKey/projectKeys";
import { shareHeldProjectKey } from "../sharedKey/projectKeySender";
import { editAuthorFor, membersWithCollaborators, NO_PROJECT_KEY_MESSAGE } from "../sharedKey/releaseEdit";
import { parseProjectKeyDM, KIND_DM_PROJECT_KEY } from "../sharedKey/projectKeyDM";
import { APP_RELAY } from "@/lib/nostr/constants";
import { relayManager } from "@/lib/nostr/relayManager";
import type { NostrEvent } from "@/types/nostr";

const ME = "a".repeat(64);
const FRIEND = "b".repeat(64);
const OTHER_PROJECT = "c".repeat(64);

beforeEach(() => {
  store.dispatch(resetAll());
  clearProjectKeySession();
  keychain.clear();
  published.length = 0;
  rumors.length = 0;
  vi.spyOn(relayManager, "connect").mockImplementation(() => undefined as never);
  vi.spyOn(relayManager, "publish").mockImplementation((event: NostrEvent, relays?: string[]) => {
    published.push({ event, relays: relays ?? [] });
    return relays?.length ?? 0;
  });
  store.dispatch(login({ pubkey: ME, signerType: "tauri_keystore" }));
});

describe("creating and sharing a project key", () => {
  it("createProjectKey holds a fresh key and returns its signer + coordinate", async () => {
    const { signer, coord } = await createProjectKey(ME, "basement-tapes");
    expect(coord).toBe(`33123:${signer.pubkey}:basement-tapes`);
    expect(store.getState().music.heldProjectKeys).toEqual({ [signer.pubkey]: coord });
  });

  it("shareHeldProjectKey sends a kind-20017 rumor the recipient can parse, also via the app relay", async () => {
    const { signer, coord } = await createProjectKey(ME, "tapes");
    await shareHeldProjectKey(signer.pubkey, FRIEND);

    expect(rumors).toHaveLength(1);
    expect(rumors[0].kind).toBe(KIND_DM_PROJECT_KEY);
    const grant = parseProjectKeyDM({ ...rumors[0], sender: ME, createdAt: 1 }, FRIEND);
    expect(grant?.coord).toBe(coord);
    expect(getPublicKey(grant!.secretKey)).toBe(signer.pubkey);

    expect(published).toHaveLength(2); // recipient + self
    for (const p of published) expect(p.relays).toContain(APP_RELAY);
    expect(published[0].relays).toContain("wss://inbox.example");
    expect(published[1].relays).toContain("wss://mine.example");
  });

  it("refuses to share a key this device doesn't hold", async () => {
    await expect(shareHeldProjectKey(OTHER_PROJECT, FRIEND)).rejects.toThrow(/isn't on this device/);
  });
});

describe("who an edit publishes as", () => {
  it("my release: me, with the account signer", async () => {
    expect(await editAuthorFor({ pubkey: ME }, ME)).toEqual({ pubkey: ME });
  });

  it("a held shared project: its key", async () => {
    const { signer } = await createProjectKey(ME, "tapes");
    const author = await editAuthorFor({ pubkey: signer.pubkey, owners: [ME] }, ME);
    expect(author.pubkey).toBe(signer.pubkey);
    expect(author.signer?.getPublicKey && (await author.signer.getPublicKey())).toBe(signer.pubkey);
  });

  it("a shared project without its key: refused, never copied under my key", async () => {
    await expect(editAuthorFor({ pubkey: OTHER_PROJECT, owners: [ME] }, ME)).rejects.toThrow(NO_PROJECT_KEY_MESSAGE);
  });

  it("someone else's personal release: a copy at my address, as before", async () => {
    expect(await editAuthorFor({ pubkey: OTHER_PROJECT }, ME)).toEqual({ pubkey: ME });
  });

  it("the private-collaborator picker maps onto collaborator member tags", () => {
    expect(
      membersWithCollaborators(
        [{ pubkey: ME, role: "owner" }, { pubkey: FRIEND, role: "collaborator" }],
        [OTHER_PROJECT],
      ),
    ).toEqual([{ pubkey: ME, role: "owner" }, { pubkey: OTHER_PROJECT, role: "collaborator" }]);
  });
});
