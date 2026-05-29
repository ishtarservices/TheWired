import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useAppSelector } from "../../store/hooks";
import { loadWalletsForAccount, resetWalletManager } from "./walletManager";
import { ZapModal } from "./ZapModal";
import type { NostrEvent } from "../../types/nostr";

export interface ZapTarget {
  recipientPubkey: string;
  /** The event being zapped (note/article/video/chat). Omit for a profile zap. */
  event?: NostrEvent;
  /** Optional display name override (avoids a flash before the profile loads). */
  displayName?: string;
}

interface ZapContextValue {
  openZap: (target: ZapTarget) => void;
}

const ZapContext = createContext<ZapContextValue | null>(null);

/**
 * Mounts once at the app root: auto-loads the active account's wallet and hosts the
 * single shared ZapModal. Surfaces call `useZap().openZap(...)` to launch it.
 */
export function WalletProvider({ children }: { children: ReactNode }) {
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const [target, setTarget] = useState<ZapTarget | null>(null);

  useEffect(() => {
    if (pubkey) {
      void loadWalletsForAccount(pubkey);
    } else {
      resetWalletManager();
    }
  }, [pubkey]);

  const openZap = useCallback((t: ZapTarget) => setTarget(t), []);

  return (
    <ZapContext.Provider value={{ openZap }}>
      {children}
      {target && (
        <ZapModal target={target} onClose={() => setTarget(null)} />
      )}
    </ZapContext.Provider>
  );
}

export function useZap(): ZapContextValue {
  const ctx = useContext(ZapContext);
  if (!ctx) throw new Error("useZap must be used within WalletProvider");
  return ctx;
}
