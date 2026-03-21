import { useState } from "react";
import { EyeOff, Eye, ShieldOff } from "lucide-react";

interface BlockedMessageProps {
  /** "chat" renders compact inline, "note" renders card-style */
  variant: "chat" | "note" | "reply";
  /** Called when user clicks "Unblock" — if provided, shows an unblock button */
  onUnblock?: () => void;
  children: React.ReactNode;
}

/**
 * Wraps content from a blocked user. Shows a placeholder with an option
 * to temporarily reveal the hidden content.
 */
export function BlockedMessage({ variant, onUnblock, children }: BlockedMessageProps) {
  const [revealed, setRevealed] = useState(false);

  if (revealed) {
    return (
      <div className="relative">
        <div className="flex items-center gap-2 mb-1">
          <button
            onClick={() => setRevealed(false)}
            className="flex items-center gap-1 text-[10px] text-muted hover:text-soft transition-colors"
          >
            <Eye size={10} />
            Hide
          </button>
          {onUnblock && (
            <button
              onClick={onUnblock}
              className="flex items-center gap-1 text-[10px] text-muted hover:text-red-400 transition-colors"
            >
              <ShieldOff size={10} />
              Unblock user
            </button>
          )}
        </div>
        <div className="opacity-50">{children}</div>
      </div>
    );
  }

  if (variant === "chat") {
    return (
      <div className="group flex items-center gap-2 px-5 py-1.5">
        <div className="flex items-center gap-1.5 rounded-md bg-surface-hover/50 px-3 py-1 text-xs text-muted">
          <EyeOff size={12} />
          <span>Blocked message</span>
        </div>
        <button
          onClick={() => setRevealed(true)}
          className="text-[10px] text-muted opacity-0 group-hover:opacity-100 hover:text-soft transition-all"
        >
          Show
        </button>
      </div>
    );
  }

  if (variant === "reply") {
    return (
      <div className="group flex items-center gap-2 border-l-2 border-edge pl-4 py-2">
        <div className="flex items-center gap-1.5 text-xs text-muted">
          <EyeOff size={12} />
          <span>Blocked message</span>
        </div>
        <button
          onClick={() => setRevealed(true)}
          className="text-[10px] text-muted opacity-0 group-hover:opacity-100 hover:text-soft transition-all"
        >
          Show
        </button>
      </div>
    );
  }

  // note variant
  return (
    <div className="group rounded-lg border border-edge bg-card/50 px-4 py-3 flex items-center gap-2">
      <div className="flex items-center gap-1.5 text-xs text-muted">
        <EyeOff size={12} />
        <span>Blocked message</span>
      </div>
      <button
        onClick={() => setRevealed(true)}
        className="text-[10px] text-muted opacity-0 group-hover:opacity-100 hover:text-soft transition-all"
      >
        Show
      </button>
    </div>
  );
}
