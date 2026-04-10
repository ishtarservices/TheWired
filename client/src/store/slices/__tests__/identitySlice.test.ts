import { describe, it, expect } from "vitest";
import { identitySlice } from "../identitySlice";
import { createTestStore } from "@/__tests__/helpers/createTestStore";
import { lunaVega, niaOkafor } from "@/__tests__/fixtures/testUsers";

const {
  login,
  logout,
  setProfile,
  setRelayList,
  setDMRelayList,
  setFollowList,
  setMuteList,
  setPinnedNotes,
  setKnownFollowers,
  addKnownFollower,
  setAccounts,
  setSwitchingAccount,
} = identitySlice.actions;

describe("identitySlice", () => {
  // ─── login / logout ────────────────────────────

  it("sets pubkey and signerType on login", () => {
    const store = createTestStore();
    store.dispatch(login({ pubkey: lunaVega.pubkey, signerType: "tauri_keystore" }));
    const state = store.getState().identity;
    expect(state.pubkey).toBe(lunaVega.pubkey);
    expect(state.signerType).toBe("tauri_keystore");
  });

  it("resets state to initial on logout", () => {
    const store = createTestStore();
    store.dispatch(login({ pubkey: lunaVega.pubkey, signerType: "nip07" }));
    store.dispatch(logout());
    const state = store.getState().identity;
    expect(state.pubkey).toBeNull();
    expect(state.signerType).toBeNull();
    expect(state.profile).toBeNull();
  });

  // ─── setProfile ────────────────────────────────

  it("sets profile when createdAt is newer", () => {
    const store = createTestStore();
    store.dispatch(
      setProfile({
        profile: { name: "Luna", about: "test" },
        createdAt: 100,
      }),
    );
    expect(store.getState().identity.profile?.name).toBe("Luna");
    expect(store.getState().identity.profileCreatedAt).toBe(100);
  });

  it("rejects profile when createdAt is older", () => {
    const store = createTestStore();
    store.dispatch(setProfile({ profile: { name: "Luna" }, createdAt: 200 }));
    store.dispatch(setProfile({ profile: { name: "Old" }, createdAt: 100 }));
    expect(store.getState().identity.profile?.name).toBe("Luna");
    expect(store.getState().identity.profileCreatedAt).toBe(200);
  });

  it("rejects profile with equal createdAt (strict greater-than guard)", () => {
    const store = createTestStore();
    store.dispatch(setProfile({ profile: { name: "V1" }, createdAt: 100 }));
    store.dispatch(setProfile({ profile: { name: "V2" }, createdAt: 100 }));
    // The slice uses strict > check, so equal timestamps are rejected
    expect(store.getState().identity.profile?.name).toBe("V1");
  });

  // ─── setRelayList ──────────────────────────────

  it("sets relay list when createdAt is newer", () => {
    const store = createTestStore();
    const entries = [{ url: "wss://r1.com", mode: "read+write" as const }];
    store.dispatch(setRelayList({ entries, createdAt: 100 }));
    expect(store.getState().identity.relayList).toHaveLength(1);
  });

  it("rejects relay list when createdAt is older", () => {
    const store = createTestStore();
    const e1 = [{ url: "wss://r1.com", mode: "read+write" as const }];
    const e2 = [{ url: "wss://r2.com", mode: "read" as const }];
    store.dispatch(setRelayList({ entries: e1, createdAt: 200 }));
    store.dispatch(setRelayList({ entries: e2, createdAt: 100 }));
    expect(store.getState().identity.relayList[0].url).toBe("wss://r1.com");
  });

  // ─── setFollowList ─────────────────────────────

  it("sets follow list with timestamp guard", () => {
    const store = createTestStore();
    store.dispatch(setFollowList({ follows: ["pk1", "pk2"], createdAt: 100 }));
    expect(store.getState().identity.followList).toEqual(["pk1", "pk2"]);
  });

  it("rejects older follow list", () => {
    const store = createTestStore();
    store.dispatch(setFollowList({ follows: ["pk1"], createdAt: 200 }));
    store.dispatch(setFollowList({ follows: ["pk2"], createdAt: 100 }));
    expect(store.getState().identity.followList).toEqual(["pk1"]);
  });

  // ─── setMuteList ───────────────────────────────

  it("sets mute list with timestamp guard", () => {
    const store = createTestStore();
    store.dispatch(
      setMuteList({
        mutes: [{ type: "pubkey", value: "pk1" }],
        createdAt: 100,
      }),
    );
    expect(store.getState().identity.muteList).toHaveLength(1);
  });

  it("rejects older mute list", () => {
    const store = createTestStore();
    store.dispatch(
      setMuteList({
        mutes: [{ type: "pubkey", value: "new" }],
        createdAt: 200,
      }),
    );
    store.dispatch(
      setMuteList({
        mutes: [{ type: "pubkey", value: "old" }],
        createdAt: 100,
      }),
    );
    expect(store.getState().identity.muteList[0].value).toBe("new");
  });

  // ─── setPinnedNotes ────────────────────────────

  it("sets pinned notes with timestamp guard", () => {
    const store = createTestStore();
    store.dispatch(setPinnedNotes({ noteIds: ["n1", "n2"], createdAt: 100 }));
    expect(store.getState().identity.pinnedNoteIds).toEqual(["n1", "n2"]);
  });

  // ─── setDMRelayList ────────────────────────────

  it("sets DM relay list with timestamp guard", () => {
    const store = createTestStore();
    store.dispatch(
      setDMRelayList({ relays: ["wss://dm.com"], createdAt: 100 }),
    );
    expect(store.getState().identity.dmRelayList).toEqual(["wss://dm.com"]);
  });

  // ─── Known followers ──────────────────────────

  it("sets known followers", () => {
    const store = createTestStore();
    store.dispatch(setKnownFollowers(["pk1", "pk2"]));
    expect(store.getState().identity.knownFollowers).toEqual(["pk1", "pk2"]);
  });

  it("adds a known follower with dedup", () => {
    const store = createTestStore();
    store.dispatch(setKnownFollowers(["pk1"]));
    store.dispatch(addKnownFollower("pk2"));
    store.dispatch(addKnownFollower("pk1")); // duplicate
    expect(store.getState().identity.knownFollowers).toEqual(["pk1", "pk2"]);
  });

  // ─── Multi-account ─────────────────────────────

  it("sets accounts list", () => {
    const store = createTestStore();
    const accounts = [
      { pubkey: lunaVega.pubkey, signerType: "tauri_keystore" as const, addedAt: 1000 },
      { pubkey: niaOkafor.pubkey, signerType: "tauri_keystore" as const, addedAt: 2000 },
    ];
    store.dispatch(setAccounts(accounts));
    expect(store.getState().identity.accounts).toHaveLength(2);
  });

  it("sets switchingAccount flag", () => {
    const store = createTestStore();
    store.dispatch(setSwitchingAccount(true));
    expect(store.getState().identity.switchingAccount).toBe(true);
    store.dispatch(setSwitchingAccount(false));
    expect(store.getState().identity.switchingAccount).toBe(false);
  });
});
