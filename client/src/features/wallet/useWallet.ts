import { useMemo } from "react";
import { useAppSelector } from "../../store/hooks";
import {
  addWallet,
  removeWallet,
  setDefaultWallet,
  reconnectWallet,
  refreshBalance,
  payInvoice,
} from "./walletManager";
import type { WalletEntry } from "../../store/slices/walletSlice";

export interface UseWalletReturn {
  /** All wallets for the active account, keyed by id (matches the slice). */
  wallets: Record<string, WalletEntry>;
  /** Sorted view of `wallets` (alphabetical by label) for stable rendering. */
  walletList: WalletEntry[];
  /** Wallets with `status === "connected"`. */
  connectedWallets: WalletEntry[];
  defaultWalletId: string | null;
  /** Resolved default wallet entry (null if none / removed). */
  defaultWallet: WalletEntry | null;
  hasConnectedWallet: boolean;
  addWallet: typeof addWallet;
  removeWallet: typeof removeWallet;
  setDefaultWallet: typeof setDefaultWallet;
  reconnect: typeof reconnectWallet;
  refreshBalance: typeof refreshBalance;
  payInvoice: typeof payInvoice;
}

export function useWallet(): UseWalletReturn {
  const wallets = useAppSelector((s) => s.wallet.wallets);
  const defaultWalletId = useAppSelector((s) => s.wallet.defaultWalletId);

  const walletList = useMemo(
    () =>
      Object.values(wallets).sort((a, b) => a.label.localeCompare(b.label)),
    [wallets],
  );
  const connectedWallets = useMemo(
    () => walletList.filter((w) => w.status === "connected"),
    [walletList],
  );
  const defaultWallet = defaultWalletId
    ? (wallets[defaultWalletId] ?? null)
    : null;

  return {
    wallets,
    walletList,
    connectedWallets,
    defaultWalletId,
    defaultWallet,
    hasConnectedWallet: connectedWallets.length > 0,
    addWallet,
    removeWallet,
    setDefaultWallet,
    reconnect: reconnectWallet,
    refreshBalance,
    payInvoice,
  };
}
