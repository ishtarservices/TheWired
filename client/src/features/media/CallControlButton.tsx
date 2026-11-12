import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * How a control reads at a glance:
 *  - neutral: available, nothing to flag
 *  - danger:  something is OFF that people expect on (muted, camera off, deafened)
 *  - accent:  something extra is ON (sharing, a music session)
 *  - end:     leaves the call
 */
export type CallControlTone = "neutral" | "danger" | "accent" | "end";

const TONE: Record<CallControlTone, string> = {
  neutral: "bg-card-hover text-heading hover:bg-border-light",
  danger: "bg-red-500/12 text-red-500 hover:bg-red-500/20",
  accent: "bg-primary/15 text-primary hover:bg-primary/25",
  end: "bg-red-500 text-white hover:bg-red-600",
};

interface CallControlButtonProps {
  /** Tooltip and accessible name. */
  label: string;
  onClick: () => void;
  tone?: CallControlTone;
  /** md = voice channel bar, lg = 1:1 call bar. */
  size?: "md" | "lg";
  /** For toggles: whether the thing the button controls is currently on. */
  pressed?: boolean;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * The round button of the call control bars. Voice channels and 1:1 calls
 * each had their own hand-rolled copy, and they had drifted: different reds,
 * a blue "sharing" state in one and the accent in the other, a crossed-out
 * monitor that read as "sharing unavailable", and no accessible names.
 */
export function CallControlButton({
  label,
  onClick,
  tone = "neutral",
  size = "md",
  pressed,
  disabled,
  className,
  children,
}: CallControlButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      className={cn(
        "rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-50",
        size === "lg" ? "p-3" : "p-2.5",
        TONE[tone],
        className,
      )}
    >
      {children}
    </button>
  );
}
