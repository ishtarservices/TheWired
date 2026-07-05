import { profileReceived, profilesHydrated, profilesSlice } from "../slices/profilesSlice";

const reduce = profilesSlice.reducer;

describe("profilesSlice", () => {
  it("stores received profiles by pubkey", () => {
    const state = reduce(
      undefined,
      profileReceived({ pubkey: "pk1", profile: { name: "alice", created_at: 100 } }),
    );
    expect(state.byPubkey.pk1.name).toBe("alice");
  });

  it("newest created_at wins (replaceable semantics)", () => {
    let state = reduce(
      undefined,
      profileReceived({ pubkey: "pk1", profile: { name: "new", created_at: 200 } }),
    );
    state = reduce(
      state,
      profileReceived({ pubkey: "pk1", profile: { name: "old", created_at: 100 } }),
    );
    expect(state.byPubkey.pk1.name).toBe("new");

    state = reduce(
      state,
      profileReceived({ pubkey: "pk1", profile: { name: "newer", created_at: 300 } }),
    );
    expect(state.byPubkey.pk1.name).toBe("newer");
  });

  it("hydration merges without clobbering newer live data", () => {
    let state = reduce(
      undefined,
      profileReceived({ pubkey: "pk1", profile: { name: "live", created_at: 500 } }),
    );
    state = reduce(
      state,
      profilesHydrated({
        pk1: { name: "cached", created_at: 100 },
        pk2: { name: "other", created_at: 100 },
      }),
    );
    expect(state.byPubkey.pk1.name).toBe("live");
    expect(state.byPubkey.pk2.name).toBe("other");
  });
});
