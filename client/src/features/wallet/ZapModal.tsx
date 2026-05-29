import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Zap, X, Loader2, Check } from "lucide-react";
import { Modal } from "../../components/ui/Modal";
import { Button } from "../../components/ui/Button";
import { Avatar } from "../../components/ui/Avatar";
import { useProfile } from "../profile/useProfile";
import { useAppDispatch } from "../../store/hooks";
import { addNotification } from "../../store/slices/notificationSlice";
import { useWallet } from "./useWallet";
import { sendZap } from "../../lib/lightning/zap";
import type { ZapTarget } from "./WalletProvider";

const PRESETS = [21, 100, 500, 1000, 5000];

export function ZapModal({
  target,
  onClose,
}: {
  target: ZapTarget;
  onClose: () => void;
}) {
  const { profile } = useProfile(target.recipientPubkey);
  const { connectedWallets, defaultWalletId, payInvoice } = useWallet();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  const hasConnectedWallet = connectedWallets.length > 0;
  const showWalletPicker = connectedWallets.length >= 2;

  const [amount, setAmount] = useState(100);
  const [comment, setComment] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  // Pre-select the default wallet if it's currently connected, else the first one.
  const [chosenWalletId, setChosenWalletId] = useState<string | null>(() => {
    if (
      defaultWalletId &&
      connectedWallets.some((w) => w.id === defaultWalletId)
    ) {
      return defaultWalletId;
    }
    return connectedWallets[0]?.id ?? null;
  });
  // Keep the selection valid as wallets come and go (e.g. one goes offline mid-modal).
  useEffect(() => {
    if (
      chosenWalletId &&
      connectedWallets.some((w) => w.id === chosenWalletId)
    ) {
      return;
    }
    const next =
      defaultWalletId &&
      connectedWallets.some((w) => w.id === defaultWalletId)
        ? defaultWalletId
        : connectedWallets[0]?.id ?? null;
    setChosenWalletId(next);
  }, [connectedWallets, defaultWalletId, chosenWalletId]);

  const lud16 = profile?.lud16;
  const displayName =
    target.displayName ||
    profile?.display_name ||
    profile?.name ||
    `${target.recipientPubkey.slice(0, 8)}…`;

  const handleZap = async () => {
    if (!lud16 || amount <= 0 || !chosenWalletId) return;
    const walletId = chosenWalletId;
    setStatus("sending");
    setError(null);
    try {
      await sendZap({
        recipientPubkey: target.recipientPubkey,
        amountSats: amount,
        comment: comment.trim() || undefined,
        event: target.event,
        lud16,
        // Bind the chosen wallet id at call time so a mid-zap re-render doesn't
        // accidentally swap wallets between request and pay.
        payInvoice: (invoice, amountMsat) =>
          payInvoice(walletId, invoice, amountMsat),
      });
      setStatus("sent");
      dispatch(
        addNotification({
          id: `zap-${Date.now()}`,
          type: "zap",
          title: "⚡ Zap sent",
          body: `${amount.toLocaleString()} sats to ${displayName}`,
          timestamp: Date.now(),
        }),
      );
      setTimeout(onClose, 1200);
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Zap failed");
    }
  };

  return (
    <Modal open onClose={onClose}>
      <div className="w-full max-w-sm rounded-2xl border-gradient card-glass p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-bold text-heading">
            <Zap size={18} className="text-yellow-400" />
            Send a Zap
          </h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-heading transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mb-4 flex items-center gap-3">
          <Avatar src={profile?.picture} alt={displayName} size="md" />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-heading">
              {displayName}
            </div>
            {lud16 && <div className="truncate text-xs text-muted">{lud16}</div>}
          </div>
        </div>

        {!lud16 ? (
          <p className="rounded-lg bg-field px-3 py-3 text-sm text-soft">
            This user hasn't set a Lightning address, so they can't receive zaps
            yet.
          </p>
        ) : !hasConnectedWallet ? (
          <div className="space-y-3">
            <p className="rounded-lg bg-field px-3 py-3 text-sm text-soft">
              Connect a Lightning wallet to send zaps.
            </p>
            <Button
              className="w-full"
              onClick={() => {
                onClose();
                navigate("/settings?tab=wallet");
              }}
            >
              Open Wallet Settings
            </Button>
          </div>
        ) : (
          <>
            {showWalletPicker && (
              <div className="mb-3">
                <label className="mb-1 block text-xs text-muted">
                  Pay from
                </label>
                <select
                  value={chosenWalletId ?? ""}
                  onChange={(e) => setChosenWalletId(e.target.value)}
                  className="w-full rounded-xl bg-field px-3 py-2 text-sm text-heading ring-1 ring-border focus:outline-none focus:ring-primary/30"
                >
                  {connectedWallets.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.label}
                      {w.balanceMsat != null
                        ? ` · ${Math.floor(w.balanceMsat / 1000).toLocaleString()} sats`
                        : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="mb-3 grid grid-cols-5 gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  onClick={() => setAmount(p)}
                  className={`rounded-lg py-2 text-xs font-medium ring-1 transition-colors ${
                    amount === p
                      ? "bg-primary/20 text-primary ring-primary/40"
                      : "bg-field text-soft ring-border hover:text-heading"
                  }`}
                >
                  {p.toLocaleString()}
                </button>
              ))}
            </div>

            <input
              type="number"
              min={1}
              value={amount}
              onChange={(e) =>
                setAmount(Math.max(0, Math.floor(Number(e.target.value) || 0)))
              }
              className="mb-3 w-full rounded-xl bg-field px-3 py-2 text-sm text-heading ring-1 ring-border focus:outline-none focus:ring-primary/30"
              placeholder="Amount in sats"
            />

            <input
              type="text"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Comment (optional)"
              className="mb-4 w-full rounded-xl bg-field px-3 py-2 text-sm text-heading ring-1 ring-border focus:outline-none focus:ring-primary/30"
            />

            {error && (
              <div className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">
                {error}
              </div>
            )}

            <Button
              className="w-full gap-2"
              disabled={status === "sending" || status === "sent" || amount <= 0}
              onClick={handleZap}
            >
              {status === "sending" ? (
                <Loader2 size={16} className="animate-spin" />
              ) : status === "sent" ? (
                <Check size={16} />
              ) : (
                <Zap size={16} />
              )}
              {status === "sending"
                ? "Zapping…"
                : status === "sent"
                  ? "Sent!"
                  : `Zap ${amount.toLocaleString()} sats`}
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}
