import { useEffect, useRef, useState } from "react";
import { Check, Loader2, AlertTriangle, Server } from "lucide-react";
import { APP_RELAY, NIP29_RELAY_PRESETS } from "../../lib/nostr/constants";
import { probeRelayNip11, type RelayInfo } from "../../lib/nostr/relayInfo";
import { hostToRelayUrl } from "./spaceType";

/** An extra host option injected by the parent (e.g. the user's self-hosted
 *  embedded relay). `info`, when given, is trusted as the relay's capability —
 *  used to skip an HTTP NIP-11 probe (which CSP blocks for loopback). */
export interface ExtraPreset {
  url: string;
  label: string;
  info?: RelayInfo;
}

interface RelayPickerProps {
  /** Currently selected relay URL (ws/wss). */
  value: string;
  onChange: (url: string) => void;
  /** Surfaced NIP-11 info for the selected relay (null while probing/unknown).
   *  Parent uses it to gate private/native options on relay capability. */
  onInfo?: (info: RelayInfo | null) => void;
  /** When true, highlight NIP-42 capability (needed for private spaces). */
  requireAuth?: boolean;
  /** Parent-supplied host options shown above the built-in presets. */
  extraPresets?: ExtraPreset[];
  /** Show the strict external NIP-29 relay presets (0xchat/fiatjaf/nip29.com).
   *  Only valid for native (9007) spaces — A-lite chat would be rejected there
   *  since those relays aren't backend-aware. Default true. */
  showNip29Presets?: boolean;
}

const WIRED_PRESET = { url: APP_RELAY, label: "The Wired (recommended)" };
const PRESETS = [WIRED_PRESET, ...NIP29_RELAY_PRESETS];

export function RelayPicker({
  value,
  onChange,
  onInfo,
  requireAuth,
  extraPresets = [],
  showNip29Presets = true,
}: RelayPickerProps) {
  const builtinPresets = showNip29Presets ? PRESETS : [WIRED_PRESET];
  const allPresets = [...extraPresets, ...builtinPresets];
  const isPreset = allPresets.some((p) => p.url === value);
  const [customUrl, setCustomUrl] = useState(isPreset ? "" : value);
  const [usingCustom, setUsingCustom] = useState(!isPreset);
  const [info, setInfo] = useState<RelayInfo | null>(null);
  const [probing, setProbing] = useState(false);
  const probeSeq = useRef(0);

  // Map of extra-preset URL → pre-known capability (trusted, skips the probe).
  const knownInfoByUrl = new Map(
    extraPresets.filter((p) => p.info).map((p) => [p.url, p.info as RelayInfo]),
  );

  // Probe the selected relay (debounced) whenever it changes.
  useEffect(() => {
    if (!value) {
      setInfo(null);
      onInfo?.(null);
      return;
    }
    // Trust parent-supplied info for self-hosted relays (HTTP NIP-11 probe of a
    // loopback address is CSP-blocked, so don't even try).
    const known = knownInfoByUrl.get(value);
    if (known) {
      setProbing(false);
      setInfo(known);
      onInfo?.(known);
      return;
    }
    const seq = ++probeSeq.current;
    setProbing(true);
    const t = setTimeout(async () => {
      const result = await probeRelayNip11(value);
      if (seq !== probeSeq.current) return; // a newer probe superseded this one
      setInfo(result);
      setProbing(false);
      onInfo?.(result);
    }, 350);
    return () => clearTimeout(t);
    // onInfo intentionally omitted — parent callbacks shouldn't retrigger probes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function selectPreset(url: string) {
    setUsingCustom(false);
    onChange(url);
  }

  function selectCustom() {
    setUsingCustom(true);
    if (customUrl.trim()) onChange(hostToRelayUrl(customUrl.trim()));
  }

  function onCustomChange(raw: string) {
    setCustomUrl(raw);
    if (raw.trim()) onChange(hostToRelayUrl(raw.trim()));
  }

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-soft">Host relay</label>
      <p className="mb-2 text-[11px] text-muted">
        {showNip29Presets
          ? "Where this space's chat is stored. Pick The Wired's relay or any NIP-29 relay — including ones used by other Nostr apps."
          : "Where this space's chat is stored. Wired-feature spaces keep membership on The Wired, so they need a Wired-compatible relay — the recommended one, or a custom relay you run that doesn't gate by NIP-29 membership."}
      </p>

      <div className="space-y-1">
        {allPresets.map((p) => (
          <label
            key={p.url}
            className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-surface-hover"
          >
            <input
              type="radio"
              name="host-relay"
              checked={!usingCustom && value === p.url}
              onChange={() => selectPreset(p.url)}
              className="border-border"
            />
            <Server size={13} className="shrink-0 text-muted" />
            <span className="text-sm text-heading">{p.label}</span>
            <span className="truncate text-[11px] text-muted">{p.url}</span>
          </label>
        ))}

        <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-surface-hover">
          <input
            type="radio"
            name="host-relay"
            checked={usingCustom}
            onChange={selectCustom}
            className="border-border"
          />
          <Server size={13} className="shrink-0 text-muted" />
          <span className="text-sm text-heading">Custom relay</span>
        </label>

        {usingCustom && (
          <input
            type="text"
            value={customUrl}
            onChange={(e) => onCustomChange(e.target.value)}
            placeholder="relay.example.com or wss://relay.example.com"
            className="mt-1 w-full rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-heading placeholder-muted transition-colors focus:border-primary focus:outline-none"
          />
        )}
      </div>

      {/* Capability badge for the selected relay */}
      {value && <CapabilityBadge probing={probing} info={info} requireAuth={requireAuth} />}
    </div>
  );
}

function CapabilityBadge({
  probing,
  info,
  requireAuth,
}: {
  probing: boolean;
  info: RelayInfo | null;
  requireAuth?: boolean;
}) {
  if (probing) {
    return (
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted">
        <Loader2 size={11} className="animate-spin" />
        Checking relay…
      </div>
    );
  }
  if (!info) {
    return (
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-400">
        <AlertTriangle size={11} />
        Couldn&apos;t read relay info (NIP-11). It may still work, but capability is unknown.
      </div>
    );
  }
  return (
    <div className="mt-2 space-y-1">
      {info.name && <div className="text-[11px] text-soft">{info.name}</div>}
      <div className="flex flex-wrap items-center gap-1.5">
        <CapChip ok={info.supportsNip29} label="NIP-29 groups" />
        {requireAuth && <CapChip ok={info.supportsNip42} label="NIP-42 auth" />}
        {info.paymentRequired && (
          <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium text-amber-400">
            paid relay
          </span>
        )}
      </div>
      {!info.supportsNip29 && (
        <div className="flex items-center gap-1.5 text-[11px] text-amber-400">
          <AlertTriangle size={11} />
          This relay doesn&apos;t advertise NIP-29 — group chat may not work.
        </div>
      )}
    </div>
  );
}

function CapChip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
        ok ? "bg-primary/10 text-primary" : "bg-faint text-muted"
      }`}
    >
      {ok ? <Check size={8} /> : <AlertTriangle size={8} />}
      {label}
    </span>
  );
}
