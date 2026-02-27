import { useState } from "react";
import { Plus, Trash2, Wifi, WifiOff } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Spinner";
import { RelayStatusBadge } from "../relay/RelayStatusBadge";
import { useAppSelector } from "../../store/hooks";
import { buildRelayListEvent } from "../../lib/nostr/eventBuilder";
import { signAndPublish } from "../../lib/nostr/publish";
import { relayManager } from "../../lib/nostr/relayManager";
import type { RelayMode, RelayListEntry } from "../../types/relay";

export function RelaySettingsTab() {
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const savedRelayList = useAppSelector((s) => s.identity.relayList);
  const connections = useAppSelector((s) => s.relays.connections);

  const [relays, setRelays] = useState<RelayListEntry[]>(() =>
    savedRelayList.length > 0
      ? savedRelayList
      : Object.values(connections).map((c) => ({ url: c.url, mode: c.mode })),
  );
  const [disabled, setDisabled] = useState<Set<string>>(() => new Set());
  const [newUrl, setNewUrl] = useState("");
  const [newMode, setNewMode] = useState<RelayMode>("read+write");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const isDirty =
    disabled.size > 0 ||
    (JSON.stringify(relays) !== JSON.stringify(savedRelayList) &&
      JSON.stringify(relays) !==
        JSON.stringify(
          Object.values(connections).map((c) => ({
            url: c.url,
            mode: c.mode,
          })),
        ));

  const addRelay = () => {
    const url = newUrl.trim();
    if (!url) return;
    if (!url.startsWith("wss://")) {
      setError("Relay URL must start with wss://");
      return;
    }
    if (relays.some((r) => r.url === url)) {
      setError("Relay already in list");
      return;
    }
    setRelays((prev) => [...prev, { url, mode: newMode }]);
    setNewUrl("");
    setError(null);
    setSuccess(false);
  };

  const removeRelay = (url: string) => {
    setRelays((prev) => prev.filter((r) => r.url !== url));
    setDisabled((prev) => {
      const next = new Set(prev);
      next.delete(url);
      return next;
    });
    setSuccess(false);
  };

  const toggleDisabled = (url: string) => {
    setDisabled((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
    setSuccess(false);
  };

  const changeMode = (url: string, mode: RelayMode) => {
    setRelays((prev) =>
      prev.map((r) => (r.url === url ? { ...r, mode } : r)),
    );
    setSuccess(false);
  };

  const handleReset = () => {
    setRelays(
      savedRelayList.length > 0
        ? savedRelayList
        : Object.values(connections).map((c) => ({
            url: c.url,
            mode: c.mode,
          })),
    );
    setDisabled(new Set());
    setError(null);
    setSuccess(false);
  };

  const handleSave = async () => {
    if (!pubkey) return;
    const enabledRelays = relays.filter((r) => !disabled.has(r.url));
    if (enabledRelays.length === 0) {
      setError("Must have at least one enabled relay");
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const unsigned = buildRelayListEvent(pubkey, enabledRelays);
      await signAndPublish(unsigned);

      // Disconnect disabled relays
      for (const url of disabled) {
        relayManager.disconnect(url);
      }

      // Connect enabled relays
      relayManager.connectFromConfig(
        enabledRelays.map((r) => ({ url: r.url, mode: r.mode })),
      );
      setSuccess(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to publish relay list");
    } finally {
      setSaving(false);
    }
  };

  const connectedCount = Object.values(connections).filter(
    (c) => c.status === "connected",
  ).length;
  const totalCount = Object.keys(connections).length;

  return (
    <div className="mx-auto w-full max-w-lg space-y-4">
      {/* Connection status banner */}
      <div className="card-glass flex items-center gap-2 rounded-xl px-4 py-3">
        {connectedCount > 0 ? (
          <Wifi size={16} className="text-green-500" />
        ) : (
          <WifiOff size={16} className="text-red-500" />
        )}
        <span className="text-sm text-heading">
          {connectedCount} of {totalCount} relay{totalCount !== 1 ? "s" : ""} connected
        </span>
      </div>

      <div className="card-glass rounded-xl p-4">
        <h3 className="mb-3 text-sm font-semibold text-heading">
          Relay List
        </h3>

        {relays.length === 0 ? (
          <p className="text-sm text-muted">No relays configured</p>
        ) : (
          <div className="space-y-2">
            {relays.map((relay) => {
              const isDisabled = disabled.has(relay.url);
              return (
                <div
                  key={relay.url}
                  className={`flex items-center gap-2 rounded-xl border border-white/[0.04] bg-white/[0.04] px-3 py-2 transition-opacity ${isDisabled ? "opacity-50" : ""}`}
                >
                  <button
                    role="switch"
                    aria-checked={!isDisabled}
                    onClick={() => toggleDisabled(relay.url)}
                    title={isDisabled ? "Enable relay" : "Disable relay"}
                    className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${
                      isDisabled ? "bg-faint" : "bg-pulse"
                    }`}
                  >
                    <span
                      className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${
                        isDisabled ? "translate-x-0.5" : "translate-x-3.5"
                      }`}
                    />
                  </button>
                  <RelayStatusBadge
                    status={
                      isDisabled
                        ? "disconnected"
                        : (connections[relay.url]?.status ?? "disconnected")
                    }
                  />
                  <span className="flex-1 truncate text-sm text-heading">
                    {relay.url.replace("wss://", "")}
                  </span>
                  <select
                    value={relay.mode}
                    onChange={(e) =>
                      changeMode(relay.url, e.target.value as RelayMode)
                    }
                    disabled={isDisabled}
                    className="rounded-xl border border-white/[0.04] bg-white/[0.04] px-1.5 py-0.5 text-xs text-soft focus:border-neon focus:outline-none disabled:opacity-50"
                  >
                    <option value="read+write">read+write</option>
                    <option value="read">read</option>
                    <option value="write">write</option>
                  </select>
                  <button
                    onClick={() => removeRelay(relay.url)}
                    className="text-muted transition-colors hover:text-red-400"
                    title="Remove relay"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="card-glass rounded-xl p-4">
        <h3 className="mb-3 text-sm font-semibold text-heading">
          Add Relay
        </h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={newUrl}
            onChange={(e) => {
              setNewUrl(e.target.value);
              setError(null);
            }}
            placeholder="wss://relay.example.com"
            className="flex-1 rounded-xl border border-white/[0.04] bg-white/[0.04] px-3 py-2 text-sm text-heading placeholder:text-faint focus:border-neon focus:outline-none transition-colors"
            onKeyDown={(e) => {
              if (e.key === "Enter") addRelay();
            }}
          />
          <select
            value={newMode}
            onChange={(e) => setNewMode(e.target.value as RelayMode)}
            className="rounded-xl border border-white/[0.04] bg-white/[0.04] px-2 py-2 text-xs text-soft focus:border-neon focus:outline-none"
          >
            <option value="read+write">read+write</option>
            <option value="read">read</option>
            <option value="write">write</option>
          </select>
          <Button size="sm" onClick={addRelay}>
            <Plus size={14} />
          </Button>
        </div>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
      {success && (
        <p className="text-xs text-green-400">Relay list published!</p>
      )}

      <div className="flex justify-end gap-2">
        {isDirty && (
          <Button variant="secondary" onClick={handleReset}>
            Reset
          </Button>
        )}
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Spinner size="sm" /> : "Save & Publish"}
        </Button>
      </div>
    </div>
  );
}
