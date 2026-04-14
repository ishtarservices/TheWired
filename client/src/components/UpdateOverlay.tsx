interface UpdateOverlayProps {
  status: string;
  version: string | null;
  progress: number | null;
  error: string | null;
  onSkip: () => void;
}

/**
 * Full-screen overlay shown when an update has been found and is
 * downloading/installing. Only rendered once an update is confirmed —
 * the silent check happens behind the normal startup UI.
 */
export function UpdateOverlay({
  status,
  version,
  progress,
  error,
  onSkip,
}: UpdateOverlayProps) {
  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-background">
      {/* Logo */}
      <img
        src="/logo.png"
        alt="The Wired"
        width={80}
        height={80}
        className="rounded-2xl"
        style={{
          animation:
            status === "downloading"
              ? "none"
              : "update-pulse 2s ease-in-out infinite",
        }}
      />

      {/* Status text */}
      <div className="mt-6 text-center">
        {status === "available" ? (
          <p className="text-sm font-medium text-muted tracking-wide">
            Update v{version} found, downloading...
          </p>
        ) : status === "downloading" ? (
          <>
            <p className="text-sm font-medium text-heading tracking-wide">
              Updating to v{version}
            </p>
            <p className="mt-1 text-xs text-muted">
              Downloading... {progress ?? 0}%
            </p>
          </>
        ) : status === "ready" ? (
          <p className="text-sm font-medium text-green-400 tracking-wide">
            Update installed, restarting...
          </p>
        ) : status === "error" ? (
          <div className="flex flex-col items-center gap-3">
            <p className="text-sm text-red-400">{error}</p>
            <button
              onClick={onSkip}
              className="rounded-lg bg-card px-4 py-2 text-sm font-medium text-heading transition-colors hover:bg-faint"
            >
              Continue anyway
            </button>
          </div>
        ) : null}
      </div>

      {/* Progress bar */}
      {(status === "downloading" || status === "ready") && (
        <div className="mt-5 h-1.5 w-56 overflow-hidden rounded-full bg-faint">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
            style={{ width: `${progress ?? 0}%` }}
          />
        </div>
      )}

      {/* Skip button */}
      {(status === "available" || status === "downloading") && (
        <button
          onClick={onSkip}
          className="mt-8 text-xs text-muted transition-colors hover:text-heading"
        >
          Skip
        </button>
      )}

      <style>{`
        @keyframes update-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.7; transform: scale(0.96); }
        }
      `}</style>
    </div>
  );
}
