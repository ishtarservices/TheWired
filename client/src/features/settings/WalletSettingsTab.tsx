import { useEffect, useMemo, useState } from "react";
import {
  Zap,
  Loader2,
  Check,
  Unplug,
  RefreshCw,
  WifiOff,
  Star,
  Plus,
  X,
} from "lucide-react";
import { Button } from "../../components/ui/Button";
import { useWallet } from "../wallet/useWallet";
import type { WalletEntry } from "../../store/slices/walletSlice";

/** Refresh while the tab is open + visible so external receipts also show up. ~120
 *  `get_balance` round-trips/hour per connected wallet while viewed; paused otherwise. */
const BALANCE_POLL_MS = 30_000;

export function WalletSettingsTab() {
  const {
    walletList,
    connectedWallets,
    defaultWalletId,
    addWallet,
    removeWallet,
    setDefaultWallet,
    reconnect,
    refreshBalance,
  } = useWallet();

  const [showAddForm, setShowAddForm] = useState(false);

  const connectedKey = useMemo(
    () => connectedWallets.map((w) => w.id).sort().join(","),
    [connectedWallets],
  );
  useEffect(() => {
    if (!connectedKey) return;
    const ids = connectedKey.split(",");
    const tick = () => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        return;
      }
      for (const id of ids) void refreshBalance(id);
    };
    const intervalId = window.setInterval(tick, BALANCE_POLL_MS);
    return () => window.clearInterval(intervalId);
  }, [connectedKey, refreshBalance]);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-heading">
          Lightning Wallets
        </h3>
        <p className="mt-1 text-xs text-muted">
          Connect one or more wallets over Nostr Wallet Connect (NWC) to send
          zaps. Your wallets stay in your control — we never hold funds. Paste a{" "}
          <code className="text-soft">nostr+walletconnect://</code> string from
          Alby Hub, Coinos, Primal, Mutiny, or any NWC-compatible wallet.
        </p>
      </div>

      {walletList.length === 0 ? (
        <AddWalletForm
          onAdd={(uri) => addWallet(uri)}
          alwaysOpen
          showLabelField={false}
        />
      ) : (
        <>
          <div className="space-y-3">
            {walletList.map((entry) => (
              <WalletCard
                key={entry.id}
                entry={entry}
                isDefault={entry.id === defaultWalletId}
                onRefresh={() => refreshBalance(entry.id)}
                onReconnect={() => reconnect(entry.id)}
                onRemove={() => removeWallet(entry.id)}
                onSetDefault={() => setDefaultWallet(entry.id)}
              />
            ))}
          </div>

          {showAddForm ? (
            <AddWalletForm
              onAdd={async (uri, label) => {
                await addWallet(uri, label);
                setShowAddForm(false);
              }}
              onCancel={() => setShowAddForm(false)}
              showLabelField
            />
          ) : (
            <Button
              variant="secondary"
              onClick={() => setShowAddForm(true)}
              className="gap-1.5"
            >
              <Plus size={14} />
              Add another wallet
            </Button>
          )}
        </>
      )}
    </div>
  );
}

function WalletCard({
  entry,
  isDefault,
  onRefresh,
  onReconnect,
  onRemove,
  onSetDefault,
}: {
  entry: WalletEntry;
  isDefault: boolean;
  onRefresh: () => Promise<void>;
  onReconnect: () => Promise<void>;
  onRemove: () => Promise<void>;
  onSetDefault: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  const run =
    (fn: () => Promise<unknown>) =>
    async (): Promise<void> => {
      setBusy(true);
      try {
        await fn();
      } catch {
        /* errors are surfaced via slice state (lastError) */
      } finally {
        setBusy(false);
      }
    };

  return (
    <div className="space-y-3 rounded-xl bg-field p-4 ring-1 ring-border">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium text-heading">
            <span className="truncate">{entry.label}</span>
            {isDefault && (
              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                Default
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate text-xs text-muted">
            {entry.walletPubkey.slice(0, 16)}…
          </div>
        </div>
        <StatusBadge status={entry.status} />
      </div>

      {entry.balanceMsat != null && (
        <div className="text-sm text-soft">
          Balance:{" "}
          <span className="font-medium text-heading">
            {Math.floor(entry.balanceMsat / 1000).toLocaleString()} sats
          </span>
        </div>
      )}

      {entry.lastError && entry.status === "error" && (
        <div className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {entry.lastError}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {entry.status === "error" ? (
          <Button onClick={run(onReconnect)} disabled={busy} className="gap-1.5">
            {busy ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            Reconnect
          </Button>
        ) : (
          <Button
            variant="secondary"
            onClick={run(onRefresh)}
            disabled={busy || entry.status !== "connected"}
            className="gap-1.5"
          >
            {busy ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            Refresh
          </Button>
        )}
        {!isDefault && entry.status === "connected" && (
          <Button
            variant="secondary"
            onClick={run(onSetDefault)}
            disabled={busy}
            className="gap-1.5"
          >
            <Star size={14} />
            Set default
          </Button>
        )}
        <Button
          variant="secondary"
          onClick={run(onRemove)}
          disabled={busy}
          className="gap-1.5"
        >
          <Unplug size={14} />
          Remove
        </Button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: WalletEntry["status"] }) {
  if (status === "connected") {
    return (
      <span className="flex shrink-0 items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-semibold text-green-400">
        <Check size={10} />
        Online
      </span>
    );
  }
  if (status === "connecting") {
    return (
      <span className="flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
        <Loader2 size={10} className="animate-spin" />
        Connecting
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="flex shrink-0 items-center gap-1 rounded-full bg-yellow-400/10 px-2 py-0.5 text-[10px] font-semibold text-yellow-400">
        <WifiOff size={10} />
        Offline
      </span>
    );
  }
  return null;
}

function AddWalletForm({
  onAdd,
  onCancel,
  alwaysOpen = false,
  showLabelField,
}: {
  onAdd: (uri: string, label?: string) => Promise<void>;
  onCancel?: () => void;
  alwaysOpen?: boolean;
  showLabelField: boolean;
}) {
  const [uri, setUri] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = uri.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await onAdd(trimmed, showLabelField ? label.trim() || undefined : undefined);
      setUri("");
      setLabel("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't connect wallet");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-xl bg-field/50 p-3 ring-1 ring-border">
      <input
        type="password"
        value={uri}
        onChange={(e) => setUri(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        placeholder="nostr+walletconnect://..."
        disabled={busy}
        className="w-full rounded-xl bg-field px-3 py-2 text-sm text-heading ring-1 ring-border placeholder-muted focus:outline-none focus:ring-primary/30"
      />
      {showLabelField && (
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (optional — defaults to the relay host)"
          disabled={busy}
          className="w-full rounded-xl bg-field px-3 py-2 text-sm text-heading ring-1 ring-border placeholder-muted focus:outline-none focus:ring-primary/30"
        />
      )}
      {error && (
        <div className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {error}
        </div>
      )}
      <div className="flex gap-2">
        <Button
          onClick={submit}
          disabled={busy || !uri.trim()}
          className="gap-1.5"
        >
          {busy ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Zap size={14} />
          )}
          Connect Wallet
        </Button>
        {!alwaysOpen && onCancel && (
          <Button
            variant="secondary"
            onClick={onCancel}
            disabled={busy}
            className="gap-1.5"
          >
            <X size={14} />
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
