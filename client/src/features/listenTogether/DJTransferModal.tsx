import { X, Crown } from "lucide-react";
import { useListenTogether } from "./useListenTogether";
import { useProfile } from "@/features/profile/useProfile";
import { Avatar } from "@/components/ui/Avatar";

interface DJTransferModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Modal for selecting a participant to transfer DJ role to.
 */
export function DJTransferModal({ open, onClose }: DJTransferModalProps) {
  const { listeners, djPubkey, transferDJ } = useListenTogether();

  if (!open) return null;

  // Exclude current DJ from transfer targets
  const targets = listeners.filter((p: string) => p !== djPubkey);

  const handleTransfer = (pubkey: string) => {
    transferDJ(pubkey);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-80 rounded-2xl bg-surface border border-edge/50 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-edge/50">
          <div className="flex items-center gap-2">
            <Crown size={14} className="text-pulse" />
            <span className="text-sm font-medium text-heading">Transfer DJ</span>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-muted hover:text-heading hover:bg-card-hover transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* Participant list */}
        <div className="max-h-64 overflow-y-auto py-1">
          {targets.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-muted">
              No other listeners to transfer to
            </div>
          ) : (
            targets.map((pubkey: string) => (
              <ParticipantRow
                key={pubkey}
                pubkey={pubkey}
                onSelect={() => handleTransfer(pubkey)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function ParticipantRow({
  pubkey,
  onSelect,
}: {
  pubkey: string;
  onSelect: () => void;
}) {
  const { profile } = useProfile(pubkey);
  const displayName = profile?.name ?? profile?.display_name ?? pubkey.slice(0, 12);

  return (
    <button
      onClick={onSelect}
      className="w-full flex items-center gap-3 px-4 py-2 hover:bg-surface-hover transition-colors text-left"
    >
      <Avatar src={profile?.picture} alt={displayName} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-heading">{displayName}</p>
        <p className="truncate text-[10px] text-muted">{pubkey.slice(0, 16)}...</p>
      </div>
      <Crown size={12} className="text-pulse/50 shrink-0" />
    </button>
  );
}
