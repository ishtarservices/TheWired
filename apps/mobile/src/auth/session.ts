// ─── Session thunks ──────────────────────────────────────────────────
// The one place that touches key persistence. All four flows converge on
// activate(): store the nsec (except hydrate), install the signer on the
// adapters object, flip identitySlice.

import { LocalNsecSigner } from "./LocalNsecSigner";
import { parseSecretInput, type IdentityKeys } from "./keys";
import type { AppThunk } from "@/store";
import { setIdentity, setLoggedOut } from "@/store/slices/identitySlice";

/** SecureStore entry holding the bech32 nsec (sanitized key-safe name). */
export const NSEC_SECRET_KEY = "identity.nsec";

/**
 * Cold-start hydration: keychain → signer → loggedIn, else loggedOut.
 * A corrupt entry is deleted rather than looping the splash forever.
 */
export function hydrateSession(): AppThunk<Promise<void>> {
  return async (dispatch, _getState, { adapters }) => {
    try {
      const stored = await adapters.secretStore.getSecret(NSEC_SECRET_KEY);
      if (!stored) {
        dispatch(setLoggedOut());
        return;
      }
      const keys = parseSecretInput(stored);
      adapters.signer = new LocalNsecSigner(keys.secretKey);
      dispatch(setIdentity({ pubkey: keys.pubkey, signerType: "local_nsec" }));
    } catch {
      await adapters.secretStore.deleteSecret(NSEC_SECRET_KEY).catch(() => {});
      dispatch(setLoggedOut());
    }
  };
}

/** Login screen: validate pasted nsec/hex, persist, activate.
 *  Throws user-presentable errors (parseSecretInput) — caller displays them. */
export function loginWithSecret(input: string): AppThunk<Promise<void>> {
  return async (dispatch, _getState, { adapters }) => {
    const keys = parseSecretInput(input);
    await adapters.secretStore.setSecret(NSEC_SECRET_KEY, keys.nsec);
    adapters.signer = new LocalNsecSigner(keys.secretKey);
    dispatch(setIdentity({ pubkey: keys.pubkey, signerType: "local_nsec" }));
  };
}

/** Create-identity walkthrough: the screen generated (and showed) the keys;
 *  this commits them once the user confirms the backup. */
export function adoptGeneratedIdentity(keys: IdentityKeys): AppThunk<Promise<void>> {
  return async (dispatch, _getState, { adapters }) => {
    await adapters.secretStore.setSecret(NSEC_SECRET_KEY, keys.nsec);
    adapters.signer = new LocalNsecSigner(keys.secretKey);
    dispatch(setIdentity({ pubkey: keys.pubkey, signerType: "local_nsec" }));
  };
}

/** Remove the key from the keychain and drop back to the auth screens. */
export function logout(): AppThunk<Promise<void>> {
  return async (dispatch, _getState, { adapters }) => {
    await adapters.secretStore.deleteSecret(NSEC_SECRET_KEY).catch(() => {});
    adapters.signer = null;
    dispatch(setLoggedOut());
  };
}
