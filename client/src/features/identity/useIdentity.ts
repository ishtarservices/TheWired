import { useCallback, useState } from "react";
import { useAppSelector, useAppDispatch } from "../../store/hooks";
import {
  performLogin,
  performLogout,
  switchAccount,
  removeAccount,
} from "../../lib/nostr/loginFlow";
import { TauriSigner } from "../../lib/nostr/tauriSigner";
import { setLoginMethod } from "../onboarding/onboardingSlice";

export function useIdentity() {
  const dispatch = useAppDispatch();
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const profile = useAppSelector((s) => s.identity.profile);
  const signerType = useAppSelector((s) => s.identity.signerType);
  const accounts = useAppSelector((s) => s.identity.accounts);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const logIn = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      dispatch(setLoginMethod("nip07"));
      await performLogin("nip07");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }, [dispatch]);

  const importNsec = useCallback(async (nsec: string) => {
    setLoading(true);
    setError(null);
    try {
      dispatch(setLoginMethod("import"));
      // importKey stores in keychain and returns pubkey -- pass it
      // through so performLogin skips the redundant keychain read
      const pubkey = await TauriSigner.importKey(nsec);
      await performLogin("tauri", pubkey);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setLoading(false);
    }
  }, [dispatch]);

  const generateNew = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      dispatch(setLoginMethod("generate"));
      // Explicitly generate a new key (don't reuse existing keys in keystore)
      const newPubkey = await TauriSigner.generateKey();
      await performLogin("tauri", newPubkey);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Key generation failed");
    } finally {
      setLoading(false);
    }
  }, [dispatch]);

  const logOut = useCallback(async () => {
    const currentPubkey = pubkey;
    if (!currentPubkey) return;
    // removeAccount handles both cases:
    // - multiple accounts → switches to next account
    // - last account → full performLogout()
    await removeAccount(currentPubkey);
  }, [pubkey]);

  const logOutAll = useCallback(async () => {
    await performLogout();
  }, []);

  const switchTo = useCallback(async (targetPubkey: string) => {
    setLoading(true);
    setError(null);
    try {
      await switchAccount(targetPubkey);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to switch account");
    } finally {
      setLoading(false);
    }
  }, []);

  const removeAccountByPubkey = useCallback(async (pk: string) => {
    try {
      await removeAccount(pk);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove account");
    }
  }, []);

  return {
    pubkey,
    profile,
    signerType,
    accounts,
    isLoggedIn: !!pubkey,
    loading,
    error,
    logIn,
    logOut,
    logOutAll,
    importNsec,
    generateNew,
    switchTo,
    removeAccount: removeAccountByPubkey,
  };
}
