import { useCallback, useEffect, useState } from "react";
import type { KeyBackupStatus } from "@/lib/nostr/tauriSigner";

/**
 * Backup state of the active Tauri keystore account, plus the action that
 * confirms a backup. `status` is null while loading, when not on Tauri, or
 * when the keystore has no active account.
 */
export function useKeyBackupStatus(enabled: boolean) {
  const [status, setStatus] = useState<KeyBackupStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const { TauriSigner } = await import("@/lib/nostr/tauriSigner");
      setStatus(await TauriSigner.backupStatus());
      setError(null);
    } catch (err) {
      setStatus(null);
      setError(err instanceof Error ? err.message : "Failed to read backup status");
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const markBackedUp = useCallback(async () => {
    if (!enabled) return;
    try {
      const { TauriSigner } = await import("@/lib/nostr/tauriSigner");
      setStatus(await TauriSigner.markBackedUp());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record backup");
    }
  }, [enabled]);

  return { status, error, refresh, markBackedUp };
}
