import { useReducer, useCallback } from "react";
import { X, Copy, Check, Send } from "lucide-react";
import { Modal } from "../../components/ui/Modal";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Spinner";
import { createInvite } from "../../lib/api/invites";
import { sendDM } from "../dm/dmService";

interface InviteGenerateModalProps {
  open: boolean;
  onClose: () => void;
  spaceId: string;
  spaceName: string;
}

const EXPIRY_OPTIONS = [
  { label: "30 minutes", hours: 0.5 },
  { label: "1 hour", hours: 1 },
  { label: "6 hours", hours: 6 },
  { label: "12 hours", hours: 12 },
  { label: "1 day", hours: 24 },
  { label: "7 days", hours: 168 },
  { label: "Never", hours: 0 },
];

const MAX_USES_OPTIONS = [
  { label: "No limit", value: 0 },
  { label: "1 use", value: 1 },
  { label: "5 uses", value: 5 },
  { label: "10 uses", value: 10 },
  { label: "25 uses", value: 25 },
  { label: "100 uses", value: 100 },
];

interface ModalState {
  expiryHours: number;
  maxUses: number;
  label: string;
  code: string | null;
  loading: boolean;
  copied: boolean;
  error: string | null;
  dmTarget: string;
  dmSending: boolean;
  dmSent: boolean;
}

type ModalAction =
  | { type: "SET_EXPIRY"; hours: number }
  | { type: "SET_MAX_USES"; value: number }
  | { type: "SET_LABEL"; value: string }
  | { type: "SET_DM_TARGET"; value: string }
  | { type: "GENERATE_START" }
  | { type: "GENERATE_SUCCESS"; code: string }
  | { type: "GENERATE_ERROR"; error: string }
  | { type: "COPY" }
  | { type: "COPY_DONE" }
  | { type: "DM_START" }
  | { type: "DM_SUCCESS" }
  | { type: "DM_DONE" }
  | { type: "DM_ERROR"; error: string }
  | { type: "SET_ERROR"; error: string }
  | { type: "RESET" };

const initialState: ModalState = {
  expiryHours: 24,
  maxUses: 0,
  label: "",
  code: null,
  loading: false,
  copied: false,
  error: null,
  dmTarget: "",
  dmSending: false,
  dmSent: false,
};

function reducer(state: ModalState, action: ModalAction): ModalState {
  switch (action.type) {
    case "SET_EXPIRY":
      return { ...state, expiryHours: action.hours };
    case "SET_MAX_USES":
      return { ...state, maxUses: action.value };
    case "SET_LABEL":
      return { ...state, label: action.value };
    case "SET_DM_TARGET":
      return { ...state, dmTarget: action.value };
    case "GENERATE_START":
      return { ...state, loading: true, error: null };
    case "GENERATE_SUCCESS":
      return { ...state, loading: false, code: action.code };
    case "GENERATE_ERROR":
      return { ...state, loading: false, error: action.error };
    case "COPY":
      return { ...state, copied: true };
    case "COPY_DONE":
      return { ...state, copied: false };
    case "DM_START":
      return { ...state, dmSending: true, error: null };
    case "DM_SUCCESS":
      return { ...state, dmSending: false, dmSent: true };
    case "DM_DONE":
      return { ...state, dmSent: false };
    case "DM_ERROR":
      return { ...state, dmSending: false, error: action.error };
    case "SET_ERROR":
      return { ...state, error: action.error };
    case "RESET":
      return initialState;
  }
}

export function InviteGenerateModal({
  open,
  onClose,
  spaceId,
  spaceName,
}: InviteGenerateModalProps) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const handleClose = useCallback(() => {
    dispatch({ type: "RESET" });
    onClose();
  }, [onClose]);

  const handleGenerate = useCallback(async () => {
    dispatch({ type: "GENERATE_START" });
    try {
      const res = await createInvite({
        spaceId,
        maxUses: state.maxUses > 0 ? state.maxUses : undefined,
        expiresInHours: state.expiryHours > 0 ? state.expiryHours : undefined,
        label: state.label.trim() || undefined,
      });
      dispatch({ type: "GENERATE_SUCCESS", code: res.data.code });
    } catch (err) {
      dispatch({
        type: "GENERATE_ERROR",
        error: err instanceof Error ? err.message : "Failed to create invite",
      });
    }
  }, [spaceId, state.maxUses, state.expiryHours, state.label]);

  const inviteLink = state.code ? `${window.location.origin}/invite/${state.code}` : "";

  const handleCopy = useCallback(async () => {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    dispatch({ type: "COPY" });
    setTimeout(() => dispatch({ type: "COPY_DONE" }), 2000);
  }, [inviteLink]);

  const handleSendDM = useCallback(async () => {
    if (!state.code || !state.dmTarget.trim()) return;
    dispatch({ type: "DM_START" });
    try {
      await sendDM(
        state.dmTarget.trim(),
        `You've been invited to join "${spaceName}"!\n\nJoin here: ${inviteLink}`,
      );
      dispatch({ type: "DM_SUCCESS" });
      setTimeout(() => dispatch({ type: "DM_DONE" }), 3000);
    } catch (err) {
      dispatch({
        type: "DM_ERROR",
        error: err instanceof Error ? err.message : "Failed to send DM",
      });
    }
  }, [state.code, state.dmTarget, spaceName, inviteLink]);

  return (
    <Modal open={open} onClose={handleClose}>
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl card-glass p-8 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-heading">Create Invite</h2>
          <button
            onClick={handleClose}
            className="rounded-full p-1 text-soft hover:bg-card-hover hover:text-heading transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {!state.code ? (
          /* Options form */
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-soft">
                Expires After
              </label>
              <select
                value={state.expiryHours}
                onChange={(e) => dispatch({ type: "SET_EXPIRY", hours: Number(e.target.value) })}
                className="w-full rounded-xl bg-field border border-border px-3 py-2 text-sm text-heading focus:border-primary focus:outline-none transition-colors"
              >
                {EXPIRY_OPTIONS.map((opt) => (
                  <option key={opt.hours} value={opt.hours}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-soft">
                Max Uses
              </label>
              <select
                value={state.maxUses}
                onChange={(e) => dispatch({ type: "SET_MAX_USES", value: Number(e.target.value) })}
                className="w-full rounded-xl bg-field border border-border px-3 py-2 text-sm text-heading focus:border-primary focus:outline-none transition-colors"
              >
                {MAX_USES_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-soft">
                Label (optional)
              </label>
              <input
                type="text"
                value={state.label}
                onChange={(e) => dispatch({ type: "SET_LABEL", value: e.target.value })}
                placeholder="e.g. For friends"
                className="w-full rounded-xl bg-field border border-border px-3 py-2 text-sm text-heading placeholder-muted focus:border-primary focus:outline-none transition-colors"
              />
            </div>

            {state.error && (
              <p className="text-xs text-red-400">{state.error}</p>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="md" onClick={handleClose}>
                Cancel
              </Button>
              <Button variant="primary" size="md" onClick={handleGenerate} disabled={state.loading}>
                {state.loading ? <Spinner size="sm" /> : "Generate"}
              </Button>
            </div>
          </div>
        ) : (
          /* Code result */
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-soft">
                Invite Link
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={inviteLink}
                  className="flex-1 rounded-xl bg-field border border-border px-3 py-2 text-sm text-heading font-mono select-all"
                />
                <Button variant="secondary" size="md" onClick={handleCopy}>
                  {state.copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                </Button>
              </div>
            </div>

            {/* Send via DM */}
            <div>
              <label className="mb-1 block text-xs font-medium text-soft">
                Send via DM (optional)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={state.dmTarget}
                  onChange={(e) => dispatch({ type: "SET_DM_TARGET", value: e.target.value })}
                  placeholder="Paste npub or hex pubkey..."
                  className="flex-1 rounded-xl bg-field border border-border px-3 py-2 text-sm text-heading placeholder-muted font-mono focus:border-primary focus:outline-none transition-colors"
                />
                <Button
                  variant="accent"
                  size="md"
                  onClick={handleSendDM}
                  disabled={!state.dmTarget.trim() || state.dmSending || state.dmSent}
                >
                  {state.dmSending ? (
                    <Spinner size="sm" />
                  ) : state.dmSent ? (
                    <Check size={14} className="text-green-400" />
                  ) : (
                    <Send size={14} />
                  )}
                </Button>
              </div>
            </div>

            {state.error && (
              <p className="text-xs text-red-400">{state.error}</p>
            )}

            <div className="flex justify-end">
              <Button variant="ghost" size="md" onClick={handleClose}>
                Done
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
