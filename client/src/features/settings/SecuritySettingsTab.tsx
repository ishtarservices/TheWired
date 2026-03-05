import { useState, useEffect, useCallback } from "react";
import { Copy, Eye, EyeOff, AlertTriangle, Trash2, LogOut, Shield, Key } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { useAppSelector } from "@/store/hooks";
import { performLogin, performLogout } from "@/lib/nostr/loginFlow";
import { logout } from "@/store/slices/identitySlice";
import { store } from "@/store";

const AUTO_HIDE_MS = 30_000;

function truncate(str: string, start = 12, end = 8): string {
  if (str.length <= start + end + 3) return str;
  return `${str.slice(0, start)}...${str.slice(-end)}`;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-soft transition-colors hover:bg-white/[0.06] hover:text-heading"
      title={`Copy ${label}`}
    >
      <Copy size={12} />
      {copied ? "Copied!" : `Copy ${label}`}
    </button>
  );
}

/** Section 1: Identity Info */
function IdentityInfoSection() {
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const signerType = useAppSelector((s) => s.identity.signerType);
  const [npub, setNpub] = useState<string>("");

  useEffect(() => {
    if (!pubkey) return;
    import("nostr-tools/nip19").then(({ npubEncode }) => {
      setNpub(npubEncode(pubkey));
    });
  }, [pubkey]);

  if (!pubkey) return null;

  const signerLabel = signerType === "nip07" ? "Browser Extension (NIP-07)" : "Tauri Keystore";

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-heading">Identity</h3>

      <div className="flex items-center gap-2">
        <span className="rounded-full bg-pulse/15 px-2.5 py-0.5 text-xs font-medium text-pulse">
          {signerLabel}
        </span>
      </div>

      <div className="space-y-2">
        <div>
          <div className="text-xs text-muted">Public Key (hex)</div>
          <div className="flex items-center gap-2">
            <code className="text-xs text-soft">{truncate(pubkey)}</code>
            <CopyButton text={pubkey} label="hex" />
          </div>
        </div>
        {npub && (
          <div>
            <div className="text-xs text-muted">Public Key (npub)</div>
            <div className="flex items-center gap-2">
              <code className="text-xs text-soft">{truncate(npub, 14, 8)}</code>
              <CopyButton text={npub} label="npub" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Section 2: Secret Key (Tauri only) */
function SecretKeySection() {
  const signerType = useAppSelector((s) => s.identity.signerType);
  const [secretHex, setSecretHex] = useState<string | null>(null);
  const [nsec, setNsec] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearSecret = useCallback(() => {
    setSecretHex(null);
    setNsec(null);
  }, []);

  // Auto-hide after 30 seconds
  useEffect(() => {
    if (!secretHex) return;
    const timer = setTimeout(clearSecret, AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [secretHex, clearSecret]);

  if (signerType === "nip07") {
    return (
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-heading">Secret Key</h3>
        <p className="text-xs text-muted">
          Your private key is managed by your browser extension. Use your extension&apos;s backup features to export it.
        </p>
      </div>
    );
  }

  const handleReveal = async () => {
    setLoading(true);
    setError(null);
    try {
      const { TauriSigner } = await import("@/lib/nostr/tauriSigner");
      const signer = new TauriSigner();
      const hex = await signer.getSecretKey();
      setSecretHex(hex);

      const { nsecEncode } = await import("nostr-tools/nip19");
      const hexBytes = new Uint8Array(hex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
      setNsec(nsecEncode(hexBytes));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to retrieve secret key");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-heading">Secret Key</h3>

      <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3">
        <div className="flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-yellow-500" />
          <p className="text-xs text-yellow-400">
            Never share your secret key. Anyone with this key has full control of your identity.
          </p>
        </div>
      </div>

      {secretHex ? (
        <div className="space-y-2">
          <div>
            <div className="text-xs text-muted">Secret Key (hex)</div>
            <div className="flex items-center gap-2">
              <code className="text-xs text-soft">{truncate(secretHex)}</code>
              <CopyButton text={secretHex} label="hex" />
            </div>
          </div>
          {nsec && (
            <div>
              <div className="text-xs text-muted">Secret Key (nsec)</div>
              <div className="flex items-center gap-2">
                <code className="text-xs text-soft">{truncate(nsec, 14, 8)}</code>
                <CopyButton text={nsec} label="nsec" />
              </div>
            </div>
          )}
          <button
            onClick={clearSecret}
            className="inline-flex items-center gap-1.5 text-xs text-soft transition-colors hover:text-heading"
          >
            <EyeOff size={12} />
            Hide
          </button>
        </div>
      ) : (
        <Button variant="secondary" size="sm" onClick={handleReveal} disabled={loading}>
          {loading ? <Spinner size="sm" /> : <Eye size={14} className="mr-1.5" />}
          Reveal Secret Key
        </Button>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

/** Section 3: Import Key (Tauri only) */
function ImportKeySection() {
  const signerType = useAppSelector((s) => s.identity.signerType);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (signerType === "nip07") return null;

  const handleImport = async () => {
    if (!input.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const { TauriSigner } = await import("@/lib/nostr/tauriSigner");
      const pubkey = await TauriSigner.importKey(input.trim());
      setInput("");
      // Re-login with the imported key
      performLogout();
      store.dispatch(logout());
      await performLogin("tauri", pubkey);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import key");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-heading">Import Key</h3>
      <p className="text-xs text-muted">
        Import an existing Nostr identity by entering its secret key (nsec or hex).
      </p>
      <div className="flex gap-2">
        <input
          type="password"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="nsec1... or hex"
          className="flex-1 rounded-lg border border-white/[0.06] bg-surface px-3 py-2 text-sm text-heading placeholder:text-muted focus:border-pulse/40 focus:outline-none"
        />
        <Button variant="secondary" size="md" onClick={handleImport} disabled={loading || !input.trim()}>
          {loading ? <Spinner size="sm" /> : <Key size={14} className="mr-1.5" />}
          Import
        </Button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

/** Section 4: Danger Zone */
function DangerZoneSection() {
  const signerType = useAppSelector((s) => s.identity.signerType);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleLogout = () => {
    performLogout();
    store.dispatch(logout());
  };

  const handleDeleteKey = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("keystore_delete_key");
      performLogout();
      store.dispatch(logout());
    } catch {
      // Key may already be deleted
      performLogout();
      store.dispatch(logout());
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-red-400">Danger Zone</h3>

      <div className="rounded-lg border border-red-500/20 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-heading">Log Out</div>
            <div className="text-xs text-muted">Clear your session. Your key remains in the keystore.</div>
          </div>
          <Button variant="secondary" size="sm" onClick={handleLogout}>
            <LogOut size={14} className="mr-1.5" />
            Log Out
          </Button>
        </div>

        {signerType === "tauri_keystore" && (
          <div className="border-t border-red-500/10 pt-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-heading">Delete Key &amp; Log Out</div>
                <div className="text-xs text-muted">
                  Permanently removes your private key from the OS keychain.
                </div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleDeleteKey}
                disabled={deleting}
                className={confirmDelete ? "!border-red-500/40 !text-red-400" : ""}
              >
                {deleting ? (
                  <Spinner size="sm" />
                ) : (
                  <Trash2 size={14} className="mr-1.5" />
                )}
                {confirmDelete ? "Confirm Delete" : "Delete Key"}
              </Button>
            </div>
            {confirmDelete && (
              <div className="mt-2 flex items-start gap-2 rounded-md bg-red-500/10 p-2">
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-red-400" />
                <p className="text-xs text-red-400">
                  This is irreversible. Make sure you have backed up your nsec before deleting.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function SecuritySettingsTab() {
  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div className="flex items-center gap-2">
        <Shield size={16} className="text-pulse" />
        <h2 className="text-sm font-bold text-heading">Security &amp; Keys</h2>
      </div>

      <IdentityInfoSection />
      <hr className="border-white/[0.04]" />
      <SecretKeySection />
      <hr className="border-white/[0.04]" />
      <ImportKeySection />
      <hr className="border-white/[0.04]" />
      <DangerZoneSection />
    </div>
  );
}
