import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2, Wifi, WifiOff } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Spinner";
import { RelayStatusBadge } from "../relay/RelayStatusBadge";
import { useAppSelector } from "../../store/hooks";
import { publishRelayList, setRelayDisabled } from "../../lib/nostr/relayList";
import { normalizeRelayUrl } from "../../lib/nostr/relayUrl";
import { APP_RELAY, BOOTSTRAP_RELAYS, INDEXER_RELAYS } from "../../lib/nostr/constants";
import type { RelayMode, RelayListEntry } from "../../types/relay";

const APP_RELAY_KEY = normalizeRelayUrl(APP_RELAY) ?? APP_RELAY;
const INDEXER_KEYS = new Set(INDEXER_RELAYS.map((u) => normalizeRelayUrl(u) ?? u));

function rowKey(r: RelayListEntry): string {
  return normalizeRelayUrl(r.url) ?? r.url;
}

/** Order-insensitive identity of a relay list (normalized url|mode pairs). */
function listKey(entries: RelayListEntry[]): string {
  return entries
    .map((r) => `${rowKey(r)}|${r.mode}`)
    .sort()
    .join(",");
}

/** Editable rows for the tab: the user's published list, or the bootstrap
 *  defaults for a user with no kind:10002 yet. NEVER seeded from live
 *  connections — those include transient relays (indexers, space hosts,
 *  the embedded relay) that must not end up in a published NIP-65 list. */
function seedRows(saved: RelayListEntry[]): RelayListEntry[] {
  return saved.length > 0
    ? saved
    : BOOTSTRAP_RELAYS.map((url) => ({ url, mode: "read+write" as RelayMode }));
}

export function RelaySettingsTab() {
  const savedRelayList = useAppSelector((s) => s.identity.relayList);
  const relayListSynced = useAppSelector((s) => s.identity.relayListCreatedAt !== 0);
  const connections = useAppSelector((s) => s.relays.connections);
  const disabledRelays = useAppSelector((s) => s.relays.disabledRelays);

  const [rows, setRows] = useState<RelayListEntry[]>(() => seedRows(savedRelayList));
  const [newUrl, setNewUrl] = useState("");
  const [newMode, setNewMode] = useState<RelayMode>("read+write");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Re-seed when the saved list changes (fresh kind:10002 from the network,
  // another device, or our own save) — but never discard unsaved edits.
  const seedKeyRef = useRef(listKey(seedRows(savedRelayList)));
  useEffect(() => {
    const newSeed = seedRows(savedRelayList);
    const newSeedKey = listKey(newSeed);
    if (newSeedKey === seedKeyRef.current) return;
    if (listKey(rows) === seedKeyRef.current) {
      setRows(newSeed);
    }
    seedKeyRef.current = newSeedKey;
  }, [savedRelayList, rows]);

  const disabledSet = useMemo(() => new Set(disabledRelays), [disabledRelays]);
  const isDirty = listKey(rows) !== listKey(savedRelayList);
  const hasPublishedList = savedRelayList.length > 0;
  const allDisabled = rows.length > 0 && rows.every((r) => disabledSet.has(rowKey(r)));

  const addRelay = () => {
    const raw = newUrl.trim();
    if (!raw) return;
    if (!raw.startsWith("wss://")) {
      setError("Relay URL must start with wss://");
      return;
    }
    const url = normalizeRelayUrl(raw);
    if (!url) {
      setError("Invalid relay URL");
      return;
    }
    if (rows.some((r) => rowKey(r) === url)) {
      setError("Relay already in list");
      return;
    }
    setRows((prev) => [...prev, { url, mode: newMode }]);
    setNewUrl("");
    setError(null);
    setSuccess(false);
  };

  const removeRow = (url: string) => {
    setRows((prev) => prev.filter((r) => r.url !== url));
    setSuccess(false);
  };

  const toggleDisabled = (url: string) => {
    const k = normalizeRelayUrl(url) ?? url;
    setRelayDisabled(k, !disabledSet.has(k)).catch((err) => {
      console.warn("[relays] failed to persist disabled state", err);
    });
  };

  const changeMode = (url: string, mode: RelayMode) => {
    setRows((prev) => prev.map((r) => (r.url === url ? { ...r, mode } : r)));
    setSuccess(false);
  };

  const handleReset = () => {
    setRows(seedRows(savedRelayList));
    setError(null);
    setSuccess(false);
  };

  const handleSave = async () => {
    if (rows.length === 0) {
      setError("Must have at least one relay");
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await publishRelayList(rows);
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

  // Live connections outside the user's list: transient feature dials (space
  // hosts, DM relays, search), indexers, the app relay, the embedded relay.
  const rowKeys = new Set(rows.map(rowKey));
  const otherConnections = Object.values(connections).filter(
    (c) => !rowKeys.has(normalizeRelayUrl(c.url) ?? c.url),
  );

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
        <h3 className="mb-1 text-sm font-semibold text-heading">
          Relay List
        </h3>
        <p className="mb-3 text-xs text-muted">
          Your published relay list (NIP-65). The toggle disables a relay on
          this device only — it stays in your published list.
        </p>
        {!hasPublishedList && relayListSynced && (
          <p className="mb-3 text-xs text-amber-400">
            No relay list published yet — these are the default relays. Save to
            publish them as your relay list.
          </p>
        )}

        {rows.length === 0 ? (
          <p className="text-sm text-muted">No relays configured</p>
        ) : (
          <div className="space-y-2">
            {rows.map((relay) => {
              const k = rowKey(relay);
              const isDisabled = disabledSet.has(k);
              const isAppRelay = k === APP_RELAY_KEY;
              return (
                <div
                  key={relay.url}
                  className={`flex items-center gap-2 rounded-xl border border-border bg-field px-3 py-2 transition-opacity ${isDisabled ? "opacity-50" : ""}`}
                >
                  <button
                    role="switch"
                    aria-checked={!isDisabled}
                    onClick={() => toggleDisabled(relay.url)}
                    title={
                      isDisabled
                        ? "Enable relay on this device"
                        : "Disable relay on this device (stays in your published list)"
                    }
                    className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${
                      isDisabled ? "bg-faint" : "bg-primary"
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
                        : (connections[k]?.status ?? "disconnected")
                    }
                  />
                  <span className="flex-1 truncate text-sm text-heading">
                    {relay.url.replace("wss://", "").replace("ws://", "")}
                  </span>
                  {isAppRelay && (
                    <span
                      className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted"
                      title="The Wired's relay — app features (spaces, DMs) may still connect to it on demand even when disabled or removed here"
                    >
                      App relay
                    </span>
                  )}
                  <select
                    value={relay.mode}
                    onChange={(e) =>
                      changeMode(relay.url, e.target.value as RelayMode)
                    }
                    className="rounded-xl border border-border bg-field px-1.5 py-0.5 text-xs text-soft focus:border-primary focus:outline-none"
                  >
                    <option value="read+write">read+write</option>
                    <option value="read">read</option>
                    <option value="write">write</option>
                  </select>
                  <button
                    onClick={() => removeRow(relay.url)}
                    className="text-muted transition-colors hover:text-red-400"
                    title="Remove relay from your published list"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {allDisabled && (
          <p className="mt-2 text-xs text-amber-400">
            All relays are disabled on this device — you'll have no general
            relay connections.
          </p>
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
            className="flex-1 rounded-xl border border-border bg-field px-3 py-2 text-sm text-heading placeholder:text-faint focus:border-primary focus:outline-none transition-colors"
            onKeyDown={(e) => {
              if (e.key === "Enter") addRelay();
            }}
          />
          <select
            value={newMode}
            onChange={(e) => setNewMode(e.target.value as RelayMode)}
            className="rounded-xl border border-border bg-field px-2 py-2 text-xs text-soft focus:border-primary focus:outline-none"
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

      {otherConnections.length > 0 && (
        <div className="card-glass rounded-xl p-4">
          <h3 className="mb-1 text-sm font-semibold text-heading">
            Other Active Connections
          </h3>
          <p className="mb-3 text-xs text-muted">
            Relays the app is using right now that aren't in your relay list —
            profile indexers, space hosts, DM relays, and similar.
          </p>
          <div className="space-y-2">
            {otherConnections.map((c) => {
              const k = normalizeRelayUrl(c.url) ?? c.url;
              const label = k === APP_RELAY_KEY
                ? "App relay"
                : INDEXER_KEYS.has(k)
                  ? "Indexer"
                  : "Transient";
              return (
                <div
                  key={c.url}
                  className="flex items-center gap-2 rounded-xl border border-border bg-field px-3 py-2"
                >
                  <RelayStatusBadge status={c.status} />
                  <span className="flex-1 truncate text-sm text-soft">
                    {c.url.replace("wss://", "").replace("ws://", "")}
                  </span>
                  <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted">
                    {label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}
      {success && (
        <p className="text-xs text-green-400">Relay list published!</p>
      )}
      {!relayListSynced && (
        <p className="text-xs text-muted">Syncing relay list from relays…</p>
      )}

      <div className="flex justify-end gap-2">
        {isDirty && hasPublishedList && (
          <Button variant="secondary" onClick={handleReset}>
            Reset
          </Button>
        )}
        <Button onClick={handleSave} disabled={saving || !relayListSynced}>
          {saving ? <Spinner size="sm" /> : "Save & Publish"}
        </Button>
      </div>
    </div>
  );
}
