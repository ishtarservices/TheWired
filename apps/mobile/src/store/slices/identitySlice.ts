// Session identity. Receives the ported desktop identitySlice at Phase 0 —
// until then it carries what the auth gate needs: who is logged in and where
// the session hydration stands.

import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

/** Mobile signer backends. local_nsec ships first; nip46 + native_keystore
 *  follow (guide 00 decisions). */
export type MobileSignerType = "local_nsec" | "nip46" | "native_keystore";

/** hydrating = reading the keychain at cold start (splash); then loggedOut
 *  (auth screens) or loggedIn (tabs). */
export type SessionStatus = "hydrating" | "loggedOut" | "loggedIn";

interface IdentityState {
  status: SessionStatus;
  pubkey: string | null;
  signerType: MobileSignerType | null;
}

const initialState: IdentityState = {
  status: "hydrating",
  pubkey: null,
  signerType: null,
};

export const identitySlice = createSlice({
  name: "identity",
  initialState,
  reducers: {
    setIdentity(
      state,
      action: PayloadAction<{ pubkey: string; signerType: MobileSignerType }>,
    ) {
      state.status = "loggedIn";
      state.pubkey = action.payload.pubkey;
      state.signerType = action.payload.signerType;
    },
    setLoggedOut(state) {
      state.status = "loggedOut";
      state.pubkey = null;
      state.signerType = null;
    },
  },
});

export const { setIdentity, setLoggedOut } = identitySlice.actions;
