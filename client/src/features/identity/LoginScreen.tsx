import { useState } from "react";
import { LogIn, Key, AlertCircle, Plus, Download } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Spinner";
import { useIdentity } from "./useIdentity";

export function LoginScreen() {
  const { logIn, importNsec, generateNew, loading, error } = useIdentity();
  const [nsecInput, setNsecInput] = useState("");
  const hasNip07 =
    typeof window !== "undefined" && "nostr" in window && !!window.nostr;
  const hasTauri =
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

  const handleImport = () => {
    const trimmed = nsecInput.trim();
    if (!trimmed) return;
    importNsec(trimmed);
  };

  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-grid">
      {/* Ambient glow */}
      <div className="pointer-events-none absolute inset-0 bg-ambient opacity-80" />

      <div className="relative z-10 w-96 rounded-xl border-neon-glow bg-panel p-8 text-center glow-neon">
        <div className="mb-6 flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-neon/10 animate-neon-breathe">
            <Key size={32} className="text-neon" />
          </div>
        </div>

        <h2 className="mb-2 text-xl font-bold text-silver-gradient tracking-wide">
          Welcome to The Wired
        </h2>
        <p className="mb-6 text-sm text-soft">
          Connect with your Nostr identity to get started
        </p>

        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-3">
          {hasNip07 && (
            <Button
              onClick={logIn}
              disabled={loading}
              className="w-full gap-2"
            >
              {loading ? <Spinner size="sm" /> : <LogIn size={16} />}
              Login with Extension
            </Button>
          )}

          {hasTauri && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="password"
                  value={nsecInput}
                  onChange={(e) => setNsecInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleImport();
                  }}
                  placeholder="nsec1... or hex secret key"
                  disabled={loading}
                  className="flex-1 rounded-lg border-neon-glow bg-field px-3 py-2 text-sm text-heading placeholder-muted focus:border-neon focus:outline-none"
                />
                <Button
                  onClick={handleImport}
                  disabled={loading || !nsecInput.trim()}
                  className="gap-1.5 whitespace-nowrap"
                >
                  <Download size={14} />
                  Import
                </Button>
              </div>
            </div>
          )}

          {hasTauri && (
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-edge-light" />
              <span className="text-xs text-muted">or</span>
              <div className="h-px flex-1 bg-edge-light" />
            </div>
          )}

          {hasTauri && (
            <Button
              onClick={generateNew}
              disabled={loading}
              variant="secondary"
              className="w-full gap-2"
            >
              {loading ? <Spinner size="sm" /> : <Plus size={16} />}
              Generate New Identity
            </Button>
          )}
        </div>

        <p className="mt-4 text-xs text-muted">
          {hasNip07 && hasTauri
            ? "Use a browser extension, import an existing key, or create a new one"
            : hasNip07
              ? "Uses your NIP-07 browser extension"
              : hasTauri
                ? "Import an existing key or generate a new identity"
                : "No signer detected. Install a NIP-07 extension or use the desktop app."}
        </p>
      </div>
    </div>
  );
}
