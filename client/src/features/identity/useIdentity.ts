import { useCallback, useState } from "react";
import { useAppSelector, useAppDispatch } from "../../store/hooks";
import { logout } from "../../store/slices/identitySlice";
import { performLogin, performLogout } from "../../lib/nostr/loginFlow";
import { TauriSigner } from "../../lib/nostr/tauriSigner";

export function useIdentity() {
  const dispatch = useAppDispatch();
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const profile = useAppSelector((s) => s.identity.profile);
  const signerType = useAppSelector((s) => s.identity.signerType);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const logIn = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await performLogin("nip07");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }, []);

  const importNsec = useCallback(async (nsec: string) => {
    setLoading(true);
    setError(null);
    try {
      // importKey stores in keychain and returns pubkey -- pass it
      // through so performLogin skips the redundant keychain read
      const pubkey = await TauriSigner.importKey(nsec);
      await performLogin("tauri", pubkey);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setLoading(false);
    }
  }, []);

  const generateNew = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await performLogin("tauri");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Key generation failed");
    } finally {
      setLoading(false);
    }
  }, []);

  const logOut = useCallback(() => {
    performLogout();
    dispatch(logout());
  }, [dispatch]);

  return {
    pubkey,
    profile,
    signerType,
    isLoggedIn: !!pubkey,
    loading,
    error,
    logIn,
    logOut,
    importNsec,
    generateNew,
  };
}
