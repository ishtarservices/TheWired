import { useState } from "react";
import { KeyRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { useListenAccessRequest } from "./useListenRequests";

interface RequestAccessButtonProps {
  /** `31683:owner:d` or `33123:owner:d`. */
  targetRef: string;
  className?: string;
}

/**
 * "Request Access" for a private release the viewer can't reach. Publishes a
 * listen request (kind 31685) and remembers it; then reads "Requested,
 * waiting on the artist" until the 7-day ask-again window opens. Renders
 * nothing when signed out, for your own release, or for a non-music ref.
 * Inline-safe (spans only) and stops click propagation so it can sit inside
 * clickable rows and cards.
 */
export function RequestAccessButton({ targetRef, className }: RequestAccessButtonProps) {
  const { record, canRequest, mayAskAgain, request, askAgain } = useListenAccessRequest(targetRef);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canRequest) return null;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The request didn't go out.");
    } finally {
      setBusy(false);
    }
  };

  const action = (label: string, fn: () => Promise<void>) => (
    <button
      type="button"
      disabled={busy}
      onClick={(e) => {
        e.stopPropagation();
        void run(fn);
      }}
      className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] font-medium text-soft transition-colors hover:border-primary/40 hover:text-heading disabled:opacity-50"
    >
      <KeyRound size={11} />
      {busy ? "Sending..." : label}
    </button>
  );

  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5 align-middle", className)}>
      {record && !mayAskAgain ? (
        <span className="text-[11px] text-muted">Requested, waiting on the artist</span>
      ) : record ? (
        <>
          <span className="text-[11px] text-muted">Requested a while ago</span>
          {action("Ask Again", askAgain)}
        </>
      ) : (
        action("Request Access", request)
      )}
      {error && <span className="text-[11px] text-red-400">{error}</span>}
    </span>
  );
}
