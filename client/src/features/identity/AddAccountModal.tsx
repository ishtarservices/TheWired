import { useState } from "react";
import { Download, Plus, X } from "lucide-react";
import { Modal } from "../../components/ui/Modal";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Spinner";
import { TauriSigner } from "../../lib/nostr/tauriSigner";
import { performLogin, performCleanup } from "../../lib/nostr/loginFlow";
import { resetAll } from "../../store";
import { setSwitchingAccount } from "../../store/slices/identitySlice";
import { setLoginMethod } from "../onboarding/onboardingSlice";
import { useAppDispatch } from "../../store/hooks";

interface AddAccountModalProps {
  open: boolean;
  onClose: () => void;
}

export function AddAccountModal({ open, onClose }: AddAccountModalProps) {
  const dispatch = useAppDispatch();
  const [nsecInput, setNsecInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleImport = async () => {
    const trimmed = nsecInput.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    dispatch(setSwitchingAccount(true));
    try {
      dispatch(setLoginMethod("import"));
      const pubkey = await TauriSigner.importKey(trimmed);
      // Clean up current account state before logging in as new account
      performCleanup();
      dispatch(resetAll());
      await performLogin("tauri", pubkey);
      setNsecInput("");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setLoading(false);
      dispatch(setSwitchingAccount(false));
    }
  };

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    dispatch(setSwitchingAccount(true));
    try {
      dispatch(setLoginMethod("generate"));
      // Explicitly generate a new key (don't reuse existing active key)
      const pubkey = await TauriSigner.generateKey();
      // Clean up current account state before logging in as new account
      performCleanup();
      dispatch(resetAll());
      await performLogin("tauri", pubkey);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Key generation failed");
    } finally {
      setLoading(false);
      dispatch(setSwitchingAccount(false));
    }
  };

  return (
    <Modal open={open} onClose={onClose}>
      <div className="w-full max-w-sm rounded-2xl border-gradient card-glass p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-heading">Add Account</h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-heading transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <p className="text-xs text-muted mb-4">
          Import an existing key or generate a new identity.
        </p>

        {error && (
          <div className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="password"
                value={nsecInput}
                onChange={(e) => setNsecInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleImport();
                }}
                placeholder="nsec1... or hex secret key"
                disabled={loading}
                className="flex-1 rounded-xl bg-field ring-1 ring-border px-3 py-2 text-sm text-heading placeholder-muted focus:ring-primary/30 focus:outline-none"
              />
              <Button
                onClick={handleImport}
                disabled={loading || !nsecInput.trim()}
                className="gap-1.5 whitespace-nowrap"
              >
                {loading ? <Spinner size="sm" /> : <Download size={14} />}
                Import
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-border-light" />
            <span className="text-xs text-muted">or</span>
            <div className="h-px flex-1 bg-border-light" />
          </div>

          <Button
            onClick={handleGenerate}
            disabled={loading}
            variant="secondary"
            className="w-full gap-2"
          >
            {loading ? <Spinner size="sm" /> : <Plus size={16} />}
            Generate New Identity
          </Button>
        </div>
      </div>
    </Modal>
  );
}
