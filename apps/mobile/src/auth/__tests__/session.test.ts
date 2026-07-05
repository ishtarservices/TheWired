// Full session lifecycle against an in-memory secret store: create → hydrate
// (fresh store, as on app relaunch) → logout → hydrate again.

import { generateIdentity } from "../keys";
import {
  adoptGeneratedIdentity,
  continueAsGuest,
  GUEST_MODE_KEY,
  hydrateSession,
  loginWithSecret,
  logout,
  NSEC_SECRET_KEY,
} from "../session";
import type { PlatformAdapters, SecretStoreAdapter } from "@/core/adapters";
import { createStore } from "@/store";

function memorySecretStore(backing: Map<string, string>): SecretStoreAdapter {
  return {
    async getSecret(key) {
      return backing.get(key) ?? null;
    },
    async setSecret(key, value) {
      backing.set(key, value);
    },
    async deleteSecret(key) {
      backing.delete(key);
    },
  };
}

/** Adapters with only what the session thunks touch. */
function testAdapters(backing: Map<string, string>): PlatformAdapters {
  return {
    secretStore: memorySecretStore(backing),
    signer: null,
  } as PlatformAdapters;
}

describe("session thunks", () => {
  it("adoptGeneratedIdentity persists the nsec, installs the signer, logs in", async () => {
    const backing = new Map<string, string>();
    const adapters = testAdapters(backing);
    const store = createStore(adapters);
    const keys = generateIdentity();

    await store.dispatch(adoptGeneratedIdentity(keys));

    expect(store.getState().identity).toEqual({
      status: "loggedIn",
      pubkey: keys.pubkey,
      signerType: "local_nsec",
    });
    expect(backing.get(NSEC_SECRET_KEY)).toBe(keys.nsec);
    await expect(adapters.signer!.getPublicKey()).resolves.toBe(keys.pubkey);
  });

  it("loginWithSecret accepts valid input and rejects garbage without state change", async () => {
    const backing = new Map<string, string>();
    const adapters = testAdapters(backing);
    const store = createStore(adapters);
    const keys = generateIdentity();

    await expect(store.dispatch(loginWithSecret("not-a-key"))).rejects.toThrow();
    expect(store.getState().identity.status).toBe("hydrating"); // untouched
    expect(backing.size).toBe(0);

    await store.dispatch(loginWithSecret(`  ${keys.nsec}  `));
    expect(store.getState().identity.pubkey).toBe(keys.pubkey);
  });

  it("hydrateSession restores a persisted session on a fresh store (relaunch)", async () => {
    const backing = new Map<string, string>();
    const keys = generateIdentity();

    const first = createStore(testAdapters(backing));
    await first.dispatch(loginWithSecret(keys.nsec));

    const relaunchAdapters = testAdapters(backing);
    const second = createStore(relaunchAdapters);
    expect(second.getState().identity.status).toBe("hydrating");

    await second.dispatch(hydrateSession());
    expect(second.getState().identity).toEqual({
      status: "loggedIn",
      pubkey: keys.pubkey,
      signerType: "local_nsec",
    });
    expect(relaunchAdapters.signer).not.toBeNull();
  });

  it("hydrateSession lands loggedOut with no stored key", async () => {
    const store = createStore(testAdapters(new Map()));
    await store.dispatch(hydrateSession());
    expect(store.getState().identity.status).toBe("loggedOut");
  });

  it("hydrateSession clears a corrupt keychain entry and lands loggedOut", async () => {
    const backing = new Map([[NSEC_SECRET_KEY, "corrupted-garbage"]]);
    const store = createStore(testAdapters(backing));

    await store.dispatch(hydrateSession());
    expect(store.getState().identity.status).toBe("loggedOut");
    expect(backing.has(NSEC_SECRET_KEY)).toBe(false);
  });

  it("continueAsGuest persists the marker and survives relaunch", async () => {
    const backing = new Map<string, string>();
    const store = createStore(testAdapters(backing));

    await store.dispatch(continueAsGuest());
    expect(store.getState().identity.status).toBe("guest");
    expect(backing.has(GUEST_MODE_KEY)).toBe(true);

    // Relaunch: fresh store, same backing → straight back to guest browsing.
    const relaunch = createStore(testAdapters(backing));
    await relaunch.dispatch(hydrateSession());
    expect(relaunch.getState().identity.status).toBe("guest");
  });

  it("a stored key outranks a stale guest marker on hydration", async () => {
    const backing = new Map<string, string>();
    const keys = generateIdentity();
    backing.set(GUEST_MODE_KEY, "1");
    backing.set(NSEC_SECRET_KEY, keys.nsec);

    const store = createStore(testAdapters(backing));
    await store.dispatch(hydrateSession());
    expect(store.getState().identity).toEqual({
      status: "loggedIn",
      pubkey: keys.pubkey,
      signerType: "local_nsec",
    });
  });

  it("logging in from guest mode clears the guest marker", async () => {
    const backing = new Map<string, string>();
    const store = createStore(testAdapters(backing));

    await store.dispatch(continueAsGuest());
    await store.dispatch(loginWithSecret(generateIdentity().nsec));

    expect(store.getState().identity.status).toBe("loggedIn");
    expect(backing.has(GUEST_MODE_KEY)).toBe(false);
  });

  it("adopting a generated identity from guest mode clears the guest marker", async () => {
    const backing = new Map<string, string>();
    const store = createStore(testAdapters(backing));

    await store.dispatch(continueAsGuest());
    await store.dispatch(adoptGeneratedIdentity(generateIdentity()));

    expect(store.getState().identity.status).toBe("loggedIn");
    expect(backing.has(GUEST_MODE_KEY)).toBe(false);
  });

  it("logout wipes the keychain entry and the signer", async () => {
    const backing = new Map<string, string>();
    const adapters = testAdapters(backing);
    const store = createStore(adapters);

    await store.dispatch(loginWithSecret(generateIdentity().nsec));
    expect(adapters.signer).not.toBeNull();

    await store.dispatch(logout());
    expect(store.getState().identity).toEqual({
      status: "loggedOut",
      pubkey: null,
      signerType: null,
    });
    expect(adapters.signer).toBeNull();
    expect(backing.size).toBe(0);
  });
});
