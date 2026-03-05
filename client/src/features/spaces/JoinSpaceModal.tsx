import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { X, ArrowLeft, Users, AlertCircle } from "lucide-react";
import { Modal } from "../../components/ui/Modal";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Spinner";
import { Avatar } from "../../components/ui/Avatar";
import { getInviteWithPreview, redeemInvite, type InviteWithPreview } from "../../lib/api/invites";
import { ApiRequestError } from "../../lib/api/client";
import { useSpace } from "./useSpace";
import { BOOTSTRAP_RELAYS } from "../../lib/nostr/constants";
import { useAppSelector, useAppDispatch } from "../../store/hooks";
import { setSidebarMode } from "../../store/slices/uiSlice";

interface JoinSpaceModalProps {
  open: boolean;
  onClose: () => void;
  initialCode?: string;
}

type Step = "input" | "preview" | "joining" | "success";

const ERROR_MESSAGES: Record<string, string> = {
  NOT_FOUND: "This invite code is invalid or has been revoked.",
  INVITE_EXPIRED: "This invite has expired.",
  INVITE_EXHAUSTED: "This invite has reached its maximum number of uses.",
  ALREADY_MEMBER: "You're already a member of this space.",
};

/** Parse an invite code from raw input (code, URL, or deep link) */
function parseInviteCode(input: string): string {
  const trimmed = input.trim();

  // Try URL patterns: .../invite/CODE or ?invite=CODE
  try {
    const url = new URL(trimmed);
    const pathMatch = url.pathname.match(/\/invite\/([A-Za-z0-9_-]+)/);
    if (pathMatch) return pathMatch[1];
    const param = url.searchParams.get("invite");
    if (param) return param;
  } catch {
    // Not a URL — treat as raw code
  }

  // Strip any leading/trailing whitespace and return
  return trimmed;
}

export function JoinSpaceModal({ open, onClose, initialCode }: JoinSpaceModalProps) {
  const { joinSpace } = useSpace();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const myPubkey = useAppSelector((s) => s.identity.pubkey);

  const [step, setStep] = useState<Step>("input");
  const [codeInput, setCodeInput] = useState(initialCode ?? "");
  const [invite, setInvite] = useState<InviteWithPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setStep("input");
    setCodeInput(initialCode ?? "");
    setInvite(null);
    setError(null);
    setLoading(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleLookup = async () => {
    const code = parseInviteCode(codeInput);
    if (!code) return;

    setError(null);
    setLoading(true);

    try {
      const res = await getInviteWithPreview(code);
      setInvite(res.data);
      setStep("preview");
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(ERROR_MESSAGES[err.code] ?? err.message);
      } else {
        setError("Failed to look up invite. Please check your connection.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async () => {
    if (!invite || !myPubkey) return;

    setStep("joining");
    setError(null);

    try {
      const res = await redeemInvite(invite.code);

      // Create local space object — use the mode from backend so read-only
      // spaces are correctly reflected for joiners
      const spaceData = res.data.space;
      const spaceMode = (spaceData?.mode as "read" | "read-write") ?? "read-write";
      joinSpace({
        id: invite.spaceId,
        name: spaceData?.name ?? "Space",
        about: spaceData?.about ?? undefined,
        picture: spaceData?.picture ?? undefined,
        mode: spaceMode,
        creatorPubkey: invite.createdBy,
        adminPubkeys: [invite.createdBy],
        memberPubkeys: [myPubkey],
        hostRelay: BOOTSTRAP_RELAYS[0],
        isPrivate: false,
        createdAt: Math.floor(Date.now() / 1000),
      });

      // Ensure sidebar shows spaces and CenterPanel navigates to the space view
      dispatch(setSidebarMode("spaces"));
      navigate("/");

      setStep("success");

      // Close modal after a brief delay (space is already selected by joinSpace)
      setTimeout(() => {
        handleClose();
      }, 1200);
    } catch (err) {
      setStep("preview");
      if (err instanceof ApiRequestError) {
        setError(ERROR_MESSAGES[err.code] ?? err.message);
      } else {
        setError("Failed to join space. Please try again.");
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && codeInput.trim()) {
      handleLookup();
    }
  };

  return (
    <Modal open={open} onClose={handleClose}>
      <div className="w-full max-w-md rounded-2xl card-glass p-8 shadow-2xl">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {step === "preview" && (
              <button
                onClick={() => { setStep("input"); setError(null); }}
                className="rounded-full p-1 text-soft hover:bg-card-hover hover:text-heading transition-colors"
              >
                <ArrowLeft size={16} />
              </button>
            )}
            <h2 className="text-lg font-bold text-heading">
              {step === "success" ? "Joined!" : "Join a Space"}
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="rounded-full p-1 text-soft hover:bg-card-hover hover:text-heading transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Step 1: Input */}
        {step === "input" && (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-soft">
                Invite Code or Link
              </label>
              <input
                type="text"
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Enter invite code..."
                autoFocus
                className="w-full rounded-xl bg-white/[0.04] border border-white/[0.04] px-3 py-2 text-sm text-heading placeholder-muted focus:border-neon focus:outline-none transition-colors"
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-xl bg-red-500/10 border border-red-500/20 px-3 py-2">
                <AlertCircle size={14} className="mt-0.5 shrink-0 text-red-400" />
                <p className="text-xs text-red-300">{error}</p>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="md" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                variant="neon"
                size="md"
                onClick={handleLookup}
                disabled={!codeInput.trim() || loading}
              >
                {loading ? <Spinner size="sm" /> : "Look Up"}
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Preview */}
        {step === "preview" && invite && (
          <div className="space-y-4">
            <div className="flex items-center gap-4 rounded-xl bg-white/[0.03] border border-white/[0.04] p-4">
              <Avatar
                src={invite.space.picture}
                alt={invite.space.name}
                size="lg"
              />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-bold text-heading truncate">
                  {invite.space.name}
                </h3>
                {invite.space.about && (
                  <p className="mt-0.5 text-xs text-muted line-clamp-2">
                    {invite.space.about}
                  </p>
                )}
                <div className="mt-1.5 flex items-center gap-1 text-muted">
                  <Users size={11} />
                  <span className="text-[11px]">
                    {invite.space.memberCount} member{invite.space.memberCount !== 1 ? "s" : ""}
                  </span>
                </div>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-xl bg-red-500/10 border border-red-500/20 px-3 py-2">
                <AlertCircle size={14} className="mt-0.5 shrink-0 text-red-400" />
                <p className="text-xs text-red-300">{error}</p>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="md" onClick={handleClose}>
                Cancel
              </Button>
              <Button variant="primary" size="md" onClick={handleJoin}>
                Join Space
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Joining */}
        {step === "joining" && (
          <div className="flex flex-col items-center py-8">
            <Spinner size="lg" />
            <p className="mt-3 text-sm text-soft">Joining space...</p>
          </div>
        )}

        {/* Step 4: Success */}
        {step === "success" && (
          <div className="flex flex-col items-center py-8">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10 text-green-400">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
            </div>
            <p className="mt-3 text-sm font-medium text-heading">
              Welcome to {invite?.space.name ?? "the space"}!
            </p>
            <p className="mt-1 text-xs text-muted">Redirecting...</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
