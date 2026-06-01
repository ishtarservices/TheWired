import { useCallback, useEffect, useState } from "react";
import { Server, Globe, Copy, Check, Trash2, AlertTriangle } from "lucide-react";
import { useAppSelector } from "../../store/hooks";
import {
  embeddedRelaySupported,
  startEmbeddedRelay,
  stopEmbeddedRelay,
  getEmbeddedRelayStats,
  resetEmbeddedRelay,
  startTunnel,
  stopTunnel,
  getTunnelStatus,
  tunnelToRelayUrl,
  formatBytes,
  type EmbeddedRelayStats,
  type TunnelStatus,
  type TunnelMode,
} from "../../lib/relay/embeddedRelay";
import { reconcileSelfHostedSpaces } from "../spaces/selfHostedReconcile";
import {
  setHostPref,
  setTunnelPref,
  getLanPref,
  setLanPref,
  getCustomTunnelUrl,
  setCustomTunnelUrl,
} from "./useEmbeddedRelayAutostart";

/** Public-access options, in recommended order. */
const TUNNEL_OPTIONS: { mode: TunnelMode; label: string; hint: string; recommended?: boolean }[] = [
  { mode: "named", label: "Default", hint: "your-id.relay.thewired.app · stable", recommended: true },
  { mode: "quick", label: "Quick", hint: "*.trycloudflare.com · ephemeral, zero-setup" },
  { mode: "custom", label: "Custom", hint: "your own tunnel or domain" },
];

const isCustomUrlValid = (url: string): boolean => /^wss?:\/\/.+/i.test(url.trim());

/**
 * Host-a-relay management panel: activate/deactivate the embedded NIP-29 relay,
 * expose it publicly via a tunnel, inspect storage, and tear it down. Desktop
 * (Tauri) only; rendered inside the Decentralized Spaces feature.
 */
export function HostRelaySection() {
  const ownerPubkey = useAppSelector((s) => s.identity.pubkey);
  const [stats, setStats] = useState<EmbeddedRelayStats | null>(null);
  const [tunnel, setTunnel] = useState<TunnelStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [wipeIdentity, setWipeIdentity] = useState(false);
  const [tunnelMode, setTunnelMode] = useState<TunnelMode>("named");
  const [customUrl, setCustomUrl] = useState(() => getCustomTunnelUrl());
  const [lanMode, setLanMode] = useState(getLanPref());

  const refresh = useCallback(async () => {
    try {
      const [s, t] = await Promise.all([getEmbeddedRelayStats(), getTunnelStatus()]);
      setStats(s);
      setTunnel(t);
      setError(null);
      // Re-point any spaces hosted on this relay to its live loopback address
      // (the port/tunnel change every restart; relayPubkey is the stable anchor).
      reconcileSelfHostedSpaces(s.status);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    if (embeddedRelaySupported()) void refresh();
  }, [refresh]);

  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      try {
        await fn();
        await refresh();
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  if (!embeddedRelaySupported()) {
    return (
      <div className="rounded-lg border border-border bg-panel p-4 text-xs text-muted">
        Hosting a relay is available in the desktop app only.
      </div>
    );
  }

  const running = stats?.status.running ?? false;
  const publicRelayUrl = tunnel?.url ? tunnelToRelayUrl(tunnel.url) : null;

  const copyUrl = async () => {
    if (!publicRelayUrl) return;
    await navigator.clipboard.writeText(publicRelayUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="rounded-lg border border-border bg-panel p-4">
      <div className="mb-1 flex items-center gap-2">
        <Server size={14} className="text-primary" />
        <h3 className="text-sm font-semibold text-heading">Host a Relay</h3>
        <span
          className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium ${
            running ? "bg-primary/20 text-primary" : "bg-faint text-muted"
          }`}
        >
          {running ? "Running" : "Stopped"}
        </span>
      </div>
      <p className="mb-3 text-xs text-muted">
        Run a NIP-29 relay on this machine to host your own spaces. It stays on
        localhost; share it over your LAN or a public address below.
      </p>

      {/* Activate / deactivate */}
      <div className="flex items-center gap-2">
        {running ? (
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                const s = await stopEmbeddedRelay();
                setHostPref(false);
                setTunnelPref(null);
                return s;
              })
            }
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-heading hover:bg-faint disabled:opacity-50"
          >
            Deactivate
          </button>
        ) : (
          <>
            <button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const s = await startEmbeddedRelay(ownerPubkey ?? undefined, lanMode);
                  setHostPref(true); // remember to auto-start on next launch
                  setLanPref(lanMode);
                  return s;
                })
              }
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              Activate
            </button>
            <label className="flex items-center gap-1.5 text-[11px] text-muted">
              <input
                type="checkbox"
                checked={lanMode}
                onChange={(e) => setLanMode(e.target.checked)}
              />
              LAN access
            </label>
          </>
        )}
      </div>

      {/* Status + stats */}
      {stats && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          {running && stats.status.ws_url && (
            <>
              <dt className="text-muted">Local address</dt>
              <dd className="truncate font-mono text-heading">{stats.status.ws_url}</dd>
            </>
          )}
          {running && stats.status.lan_url && (
            <>
              <dt className="text-muted">LAN address</dt>
              <dd className="truncate font-mono text-heading select-all">{stats.status.lan_url}</dd>
            </>
          )}
          {stats.status.pubkey && (
            <>
              <dt className="text-muted">Relay key</dt>
              <dd className="truncate font-mono text-heading">
                {stats.status.pubkey.slice(0, 16)}…
              </dd>
            </>
          )}
          <dt className="text-muted">Groups hosted</dt>
          <dd className="text-heading">{stats.group_count}</dd>
          <dt className="text-muted">Events stored</dt>
          <dd className="text-heading">{stats.event_count}</dd>
          <dt className="text-muted">Storage used</dt>
          <dd className="text-heading">{formatBytes(stats.db_size_bytes)}</dd>
        </dl>
      )}

      {/* Public tunnel */}
      <div className="mt-4 border-t border-border pt-3">
        <div className="mb-2 flex items-center gap-2">
          <Globe size={13} className="text-muted" />
          <span className="text-xs font-medium text-heading">Public access</span>
          {tunnel?.running && (
            <span className="ml-auto rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-medium text-primary">
              Online
            </span>
          )}
        </div>
        {tunnel?.running && publicRelayUrl ? (
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-faint px-2 py-1 text-[11px] text-heading">
              {publicRelayUrl}
            </code>
            <button
              onClick={copyUrl}
              className="shrink-0 rounded-md border border-border p-1.5 text-muted hover:bg-faint"
              aria-label="Copy relay URL"
            >
              {copied ? <Check size={13} className="text-primary" /> : <Copy size={13} />}
            </button>
            <button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const s = await stopTunnel();
                  setTunnelPref(null);
                  return s;
                })
              }
              className="shrink-0 rounded-md border border-border px-2.5 py-1.5 text-xs text-heading hover:bg-faint disabled:opacity-50"
            >
              Stop
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="space-y-1.5">
              {TUNNEL_OPTIONS.map((opt) => (
                <button
                  key={opt.mode}
                  type="button"
                  onClick={() => setTunnelMode(opt.mode)}
                  className={`flex w-full items-center gap-2.5 rounded-md border px-2.5 py-1.5 text-left transition-colors ${
                    tunnelMode === opt.mode
                      ? "border-primary/40 bg-primary/10"
                      : "border-border bg-surface hover:bg-faint"
                  }`}
                >
                  <span
                    className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border ${
                      tunnelMode === opt.mode ? "border-primary" : "border-muted"
                    }`}
                  >
                    {tunnelMode === opt.mode && (
                      <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="text-[11px] font-medium text-heading">{opt.label}</span>
                      {opt.recommended && (
                        <span className="rounded-full bg-primary/20 px-1.5 py-px text-[9px] font-medium text-primary">
                          Recommended
                        </span>
                      )}
                    </span>
                    <span className="block truncate font-mono text-[10px] text-muted">
                      {opt.hint}
                    </span>
                  </span>
                </button>
              ))}
            </div>

            {tunnelMode === "custom" && (
              <input
                type="text"
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                placeholder="wss://relay.mydomain.com"
                spellCheck={false}
                className="w-full rounded-md border border-border bg-field px-2.5 py-1.5 font-mono text-[11px] text-heading placeholder-muted focus:border-primary focus:outline-none"
              />
            )}

            <button
              disabled={busy || !running || (tunnelMode === "custom" && !isCustomUrlValid(customUrl))}
              onClick={() =>
                run(async () => {
                  const url = customUrl.trim();
                  const s = await startTunnel(tunnelMode, tunnelMode === "custom" ? url : undefined);
                  setTunnelPref(tunnelMode); // restore on next launch
                  if (tunnelMode === "custom") setCustomTunnelUrl(url);
                  return s;
                })
              }
              title={running ? undefined : "Activate the relay first"}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-heading hover:bg-faint disabled:opacity-50"
            >
              {tunnelMode === "custom" ? "Use this URL" : "Expose publicly"}
            </button>

            <p className="text-[10px] text-muted">
              {tunnelMode === "named" &&
                "A stable address on The Wired's domain, tied to your relay — provisioned once, reused on every restart. Reachable while this app and the tunnel run."}
              {tunnelMode === "quick" &&
                "A throwaway Cloudflare URL that changes each restart; zero setup (cloudflared auto-downloads on first use). Reachable while this app and the tunnel run."}
              {tunnelMode === "custom" &&
                "Point your own tunnel or reverse proxy at this machine's relay port, then paste its public wss:// URL — The Wired runs nothing for you. Reachable while your tunnel and this app run."}
            </p>
          </div>
        )}
      </div>

      {/* Teardown */}
      <div className="mt-4 border-t border-border pt-3">
        {!confirmReset ? (
          <button
            onClick={() => setConfirmReset(true)}
            className="flex items-center gap-1.5 text-xs text-red-400 hover:underline"
          >
            <Trash2 size={12} /> Delete hosted data…
          </button>
        ) : (
          <div className="rounded-md border border-red-500/40 bg-red-500/5 p-2.5">
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-red-400">
              <AlertTriangle size={13} /> Delete all hosted relay data?
            </div>
            <p className="mb-2 text-[11px] text-muted">
              Stops the relay and erases every event and group it stores. This
              cannot be undone.
            </p>
            <label className="mb-2 flex items-center gap-1.5 text-[11px] text-muted">
              <input
                type="checkbox"
                checked={wipeIdentity}
                onChange={(e) => setWipeIdentity(e.target.checked)}
              />
              Also reset the relay's signing key (changes its identity — members
              of hosted groups must re-trust it)
            </label>
            <div className="flex gap-2">
              <button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const s = await resetEmbeddedRelay(wipeIdentity);
                    setHostPref(false);
                    setTunnelPref(null);
                    return s;
                  }).then(() => {
                    setConfirmReset(false);
                    setWipeIdentity(false);
                  })
                }
                className="rounded-md bg-red-500 px-3 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                Delete
              </button>
              <button
                onClick={() => setConfirmReset(false)}
                className="rounded-md border border-border px-3 py-1 text-xs text-heading hover:bg-faint"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {error && <p className="mt-3 text-[11px] text-red-400">{error}</p>}
    </div>
  );
}
