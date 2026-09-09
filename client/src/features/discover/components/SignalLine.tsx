import { cn } from "@/lib/utils";

/**
 * The single "show your work" primitive: the mono why-line under a ranked row.
 * Renders nothing on null — an empty line beats an invented one.
 */
export function SignalLine({ label, className }: { label: string | null; className?: string }) {
  if (!label) return null;
  return (
    <span
      data-testid="signal-line"
      className={cn("truncate font-mono text-[10px] tabular-nums text-faint", className)}
    >
      {label}
    </span>
  );
}
