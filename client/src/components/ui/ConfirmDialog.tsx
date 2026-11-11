import { useState, type ReactNode } from "react";
import { Modal } from "./Modal";
import { Button } from "./Button";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  /** Destructive actions get the red button. */
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}

/** A small yes/no dialog. Shows the action's error inline instead of closing. */
export function ConfirmDialog({ open, title, body, confirmLabel, danger, onConfirm, onClose }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose}>
      <div className="w-full max-w-sm rounded-2xl card-glass p-6 shadow-2xl" role="alertdialog" aria-label={title}>
        <h2 className="mb-2 text-base font-bold text-heading">{title}</h2>
        <div className="text-sm text-soft">{body}</div>
        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="md" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <button
            onClick={handleConfirm}
            disabled={busy}
            className={
              danger
                ? "rounded-xl bg-red-500/15 px-4 py-2 text-sm font-semibold text-red-400 hover:bg-red-500/25 transition-colors disabled:opacity-50"
                : "rounded-xl bg-primary/15 px-4 py-2 text-sm font-semibold text-primary-soft hover:bg-primary/25 transition-colors disabled:opacity-50"
            }
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
