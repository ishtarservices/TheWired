import { useState } from "react";
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

export function InviteGenerateModal({
  open,
  onClose,
  spaceId,
  spaceName,
}: InviteGenerateModalProps) {
  const [expiryHours, setExpiryHours] = useState(24);
  const [maxUses, setMaxUses] = useState(0);
  const [label, setLabel] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dmTarget, setDmTarget] = useState("");
  const [dmSending, setDmSending] = useState(false);
  const [dmSent, setDmSent] = useState(false);

  const reset = () => {
    setExpiryHours(24);
    setMaxUses(0);
    setLabel("");
    setCode(null);
    setLoading(false);
    setCopied(false);
    setError(null);
    setDmTarget("");
    setDmSending(false);
    setDmSent(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await createInvite({
        spaceId,
        maxUses: maxUses > 0 ? maxUses : undefined,
        expiresInHours: expiryHours > 0 ? expiryHours : undefined,
        label: label.trim() || undefined,
      });
      setCode(res.data.code);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create invite");
    } finally {
      setLoading(false);
    }
  };

  const inviteLink = code ? `${window.location.origin}/invite/${code}` : "";

  const handleCopy = async () => {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSendDM = async () => {
    if (!code || !dmTarget.trim()) return;
    setError(null);
    setDmSending(true);
    try {
      await sendDM(
        dmTarget.trim(),
        `You've been invited to join "${spaceName}"!\n\nJoin here: ${inviteLink}`,
      );
      setDmSent(true);
      setTimeout(() => setDmSent(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send DM");
    } finally {
      setDmSending(false);
    }
  };

  return (
    <Modal open={open} onClose={handleClose}>
      <div className="w-full max-w-md rounded-2xl card-glass p-8 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-heading">Create Invite</h2>
          <button
            onClick={handleClose}
            className="rounded-full p-1 text-soft hover:bg-card-hover hover:text-heading transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {!code ? (
          /* Options form */
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-soft">
                Expires After
              </label>
              <select
                value={expiryHours}
                onChange={(e) => setExpiryHours(Number(e.target.value))}
                className="w-full rounded-xl bg-field border border-edge px-3 py-2 text-sm text-heading focus:border-neon focus:outline-none transition-colors"
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
                value={maxUses}
                onChange={(e) => setMaxUses(Number(e.target.value))}
                className="w-full rounded-xl bg-field border border-edge px-3 py-2 text-sm text-heading focus:border-neon focus:outline-none transition-colors"
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
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. For friends"
                className="w-full rounded-xl bg-field border border-edge px-3 py-2 text-sm text-heading placeholder-muted focus:border-neon focus:outline-none transition-colors"
              />
            </div>

            {error && (
              <p className="text-xs text-red-400">{error}</p>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="md" onClick={handleClose}>
                Cancel
              </Button>
              <Button variant="primary" size="md" onClick={handleGenerate} disabled={loading}>
                {loading ? <Spinner size="sm" /> : "Generate"}
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
                  className="flex-1 rounded-xl bg-field border border-edge px-3 py-2 text-sm text-heading font-mono select-all"
                />
                <Button variant="secondary" size="md" onClick={handleCopy}>
                  {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
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
                  value={dmTarget}
                  onChange={(e) => setDmTarget(e.target.value)}
                  placeholder="Paste npub or hex pubkey..."
                  className="flex-1 rounded-xl bg-field border border-edge px-3 py-2 text-sm text-heading placeholder-muted font-mono focus:border-neon focus:outline-none transition-colors"
                />
                <Button
                  variant="neon"
                  size="md"
                  onClick={handleSendDM}
                  disabled={!dmTarget.trim() || dmSending || dmSent}
                >
                  {dmSending ? (
                    <Spinner size="sm" />
                  ) : dmSent ? (
                    <Check size={14} className="text-green-400" />
                  ) : (
                    <Send size={14} />
                  )}
                </Button>
              </div>
            </div>

            {error && (
              <p className="text-xs text-red-400">{error}</p>
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
