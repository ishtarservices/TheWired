// ─── Session thunks ──────────────────────────────────────────────────
// The one place that touches key persistence. Login/adopt converge on the
// same steps: store the nsec, install the signer on the adapters object,
// flip identitySlice. Guest mode (App Store 5.1.1(v): public content must be
// browsable without an account) is a persisted marker so relaunches return
// to browsing, not the Welcome screen.

import { LocalNsecSigner } from "./LocalNsecSigner";
import { parseSecretInput, type IdentityKeys } from "./keys";
import type { AppThunk } from "@/store";
import { setGuest, setIdentity, setLoggedOut } from "@/store/slices/identitySlice";

/** SecureStore entry holding the bech32 nsec (sanitized key-safe name). */
export const NSEC_SECRET_KEY = "identity.nsec";

/** SecureStore marker: user chose to browse without an account. Not a secret,
 *  but SecureStore is the only persistence wired until the StorageAdapter
 *  lands (Phase 1) — migrate then. */
export const GUEST_MODE_KEY = "session.guest";

/**
 * Cold-start hydration, in precedence order: valid stored key → loggedIn;
 * guest marker → guest; nothing → loggedOut (auth screens). A corrupt
 * keychain entry is deleted rather than looping the splash forever.
 */
export function hydrateSession(): AppThunk<Promise<void>> {
  return async (dispatch, _getState, { adapters }) => {
    try {
      const stored = await adapters.secretStore.getSecret(NSEC_SECRET_KEY);
      if (stored) {
        const keys = parseSecretInput(stored);
        adapters.signer = new LocalNsecSigner(keys.secretKey);
        dispatch(setIdentity({ pubkey: keys.pubkey, signerType: "local_nsec" }));
        return;
      }
    } catch {
      await adapters.secretStore.deleteSecret(NSEC_SECRET_KEY).catch(() => {});
    }

    const guest = await adapters.secretStore
      .getSecret(GUEST_MODE_KEY)
      .catch(() => null);
    if (guest) {
      dispatch(setGuest());
      return;
    }

    dispatch(setLoggedOut());
  };
}

/** Welcome screen: browse read-only without keys. Persisted so relaunches
 *  come straight back to guest browsing. */
export function continueAsGuest(): AppThunk<Promise<void>> {
  return async (dispatch, _getState, { adapters }) => {
    await adapters.secretStore.setSecret(GUEST_MODE_KEY, "1").catch(() => {});
    dispatch(setGuest());
  };
}

/** Login screen: validate pasted nsec/hex, persist, activate.
 *  Throws user-presentable errors (parseSecretInput) — caller displays them. */
export function loginWithSecret(input: string): AppThunk<Promise<void>> {
  return async (dispatch, _getState, { adapters }) => {
    const keys = parseSecretInput(input);
    await adapters.secretStore.setSecret(NSEC_SECRET_KEY, keys.nsec);
    await adapters.secretStore.deleteSecret(GUEST_MODE_KEY).catch(() => {});
    adapters.signer = new LocalNsecSigner(keys.secretKey);
    dispatch(setIdentity({ pubkey: keys.pubkey, signerType: "local_nsec" }));
  };
}

/** Create-identity walkthrough: the screen generated (and showed) the keys;
 *  this commits them once the user confirms the backup. */
export function adoptGeneratedIdentity(keys: IdentityKeys): AppThunk<Promise<void>> {
  return async (dispatch, _getState, { adapters }) => {
    await adapters.secretStore.setSecret(NSEC_SECRET_KEY, keys.nsec);
    await adapters.secretStore.deleteSecret(GUEST_MODE_KEY).catch(() => {});
    adapters.signer = new LocalNsecSigner(keys.secretKey);
    dispatch(setIdentity({ pubkey: keys.pubkey, signerType: "local_nsec" }));
  };
}

/** Remove the key (and any guest marker) and drop back to the auth screens. */
export function logout(): AppThunk<Promise<void>> {
  return async (dispatch, _getState, { adapters }) => {
    await adapters.secretStore.deleteSecret(NSEC_SECRET_KEY).catch(() => {});
    await adapters.secretStore.deleteSecret(GUEST_MODE_KEY).catch(() => {});
    adapters.signer = null;
    dispatch(setLoggedOut());
  };
}
