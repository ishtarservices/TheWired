import { describe, it, expect, beforeEach, vi } from "vitest";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";

const keychain = new Map<string, string>();
vi.mock("@/lib/nostr/secretStore", () => ({
  getSecret: async (k: string) => keychain.get(k) ?? null,
  setSecret: async (k: string, v: string) => void keychain.set(k, v),
  deleteSecret: async (k: string) => void keychain.delete(k),
}));

import {
  MAX_PROJECT_KEYS,
  forgetProjectKey,
  listProjectKeys,
  loadProjectSecret,
  projectKeyIndexSlot,
  projectKeySlot,
  saveProjectKey,
} from "../sharedKey/projectKeyStore";

const ACCOUNT = "a".repeat(64);
const OTHER_ACCOUNT = "b".repeat(64);

function newKey(sentAt = Math.floor(Date.now() / 1000)) {
  const secretKey = generateSecretKey();
  const projectPubkey = getPublicKey(secretKey);
  return { secretKey, projectPubkey, coord: `33123:${projectPubkey}:d`, sentAt };
}

beforeEach(() => keychain.clear());

describe("project key store", () => {
  it("stores the slot + index under the shared entry names and reads them back", async () => {
    const key = newKey();
    expect(await saveProjectKey(ACCOUNT, key)).toBe("stored");

    const slot = JSON.parse(keychain.get(projectKeySlot(ACCOUNT, key.projectPubkey))!);
    expect(slot.a).toBe(key.coord);
    expect(slot.nsec).toMatch(/^nsec1/);
    expect(typeof slot.at).toBe("number");
    const index = JSON.parse(keychain.get(projectKeyIndexSlot(ACCOUNT))!);
    expect(index).toMatchObject({ v: 1, keys: [key.projectPubkey] });

    expect(await listProjectKeys(ACCOUNT)).toEqual({ [key.projectPubkey]: key.coord });
    const sk = await loadProjectSecret(ACCOUNT, key.projectPubkey);
    expect(getPublicKey(sk!)).toBe(key.projectPubkey);
  });

  it("is scoped per account", async () => {
    const key = newKey();
    await saveProjectKey(ACCOUNT, key);
    expect(await listProjectKeys(OTHER_ACCOUNT)).toEqual({});
    expect(await loadProjectSecret(OTHER_ACCOUNT, key.projectPubkey)).toBeNull();
  });

  it("a second copy of a held key is 'known' and doesn't duplicate the index", async () => {
    const key = newKey();
    await saveProjectKey(ACCOUNT, key);
    expect(await saveProjectKey(ACCOUNT, key)).toBe("known");
    expect(JSON.parse(keychain.get(projectKeyIndexSlot(ACCOUNT))!).keys).toHaveLength(1);
  });

  it("concurrent saves all land in the index", async () => {
    const keys = [newKey(), newKey(), newKey(), newKey()];
    await Promise.all(keys.map((k) => saveProjectKey(ACCOUNT, k)));
    expect(Object.keys(await listProjectKeys(ACCOUNT)).sort()).toEqual(keys.map((k) => k.projectPubkey).sort());
  });

  it("forget deletes the slot and refuses a replay of an older key DM", async () => {
    const key = newKey(1_000);
    await saveProjectKey(ACCOUNT, key);
    await forgetProjectKey(ACCOUNT, key.projectPubkey);

    expect(keychain.has(projectKeySlot(ACCOUNT, key.projectPubkey))).toBe(false);
    expect(await listProjectKeys(ACCOUNT)).toEqual({});
    expect(await saveProjectKey(ACCOUNT, key)).toBe("forgotten");
  });

  it("a re-share sent after the key was forgotten is accepted", async () => {
    const key = newKey(1_000);
    await saveProjectKey(ACCOUNT, key);
    await forgetProjectKey(ACCOUNT, key.projectPubkey);
    expect(await saveProjectKey(ACCOUNT, { ...key, sentAt: Math.floor(Date.now() / 1000) + 5 })).toBe("stored");
    const index = JSON.parse(keychain.get(projectKeyIndexSlot(ACCOUNT))!);
    expect(index.gone[key.projectPubkey]).toBeUndefined();
  });

  it("caps held keys at 64", async () => {
    for (let i = 0; i < MAX_PROJECT_KEYS; i++) await saveProjectKey(ACCOUNT, newKey());
    expect(await saveProjectKey(ACCOUNT, newKey())).toBe("full");
    expect(Object.keys(await listProjectKeys(ACCOUNT))).toHaveLength(MAX_PROJECT_KEYS);
  });

  it("skips an index entry whose slot is gone and survives a corrupt index", async () => {
    const key = newKey();
    await saveProjectKey(ACCOUNT, key);
    keychain.delete(projectKeySlot(ACCOUNT, key.projectPubkey));
    expect(await listProjectKeys(ACCOUNT)).toEqual({});

    keychain.set(projectKeyIndexSlot(ACCOUNT), "{not json");
    expect(await listProjectKeys(ACCOUNT)).toEqual({});
    expect(await saveProjectKey(ACCOUNT, newKey())).toBe("stored");
  });
});
