/**
 * Per-pubkey profile resolution tracker.
 *
 * Records the full timeline of how each pubkey's kind:0 profile was (or wasn't)
 * resolved, so we can answer "why is this user showing a hash instead of a name?"
 * at a glance:
 *
 *     wiredDebug.profiles()        // console.table of every tracked pubkey
 *     wiredDebug.profiles("pend")  // only still-unresolved ones
 *
 * Each row shows: when it was first requested, the IDB result, which batch it
 * went into, where it finally resolved from (memory / idb / relay), how long
 * that took, and the resolved name. A pubkey stuck in `pending` or `timeout`
 * with no name is exactly the bug case.
 */
import { registerDebugCommand } from "./logger";

type ResolveSource = "memory" | "idb" | "relay" | "backend";
type TraceState = "pending" | "resolved" | "timeout";

interface ProfileTrace {
  pubkey: string;
  /** ms since session start when first requested */
  requestedAt: number;
  idbResult?: "hit" | "miss" | "stale" | "error";
  idbMs?: number;
  batchId?: number;
  batchRelays?: number;
  batchConnected?: number;
  state: TraceState;
  resolvedFrom?: ResolveSource;
  resolvedAt?: number;
  resolvedRelay?: string;
  name?: string;
}

const MAX_TRACES = 4000;
const traces = new Map<string, ProfileTrace>();

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** Evict oldest resolved traces once we exceed the cap (keep pending ones). */
function evictIfNeeded(): void {
  if (traces.size <= MAX_TRACES) return;
  for (const [pk, tr] of traces) {
    if (traces.size <= MAX_TRACES) break;
    if (tr.state !== "pending") traces.delete(pk);
  }
}

/** A component/cache asked for this pubkey's profile. */
export function trackRequest(pubkey: string): void {
  const existing = traces.get(pubkey);
  if (existing) {
    // Re-request after a timeout means a fresh attempt is underway.
    if (existing.state === "timeout") {
      existing.state = "pending";
      existing.requestedAt = now();
    }
    return;
  }
  traces.set(pubkey, { pubkey, requestedAt: now(), state: "pending" });
  evictIfNeeded();
}

/** Result of the IndexedDB lookup performed during subscribe(). */
export function markIdb(
  pubkey: string,
  result: "hit" | "miss" | "stale" | "error",
  ms: number,
): void {
  const tr = traces.get(pubkey);
  if (!tr) return;
  tr.idbResult = result;
  tr.idbMs = ms;
}

/** This pubkey was flushed in a relay batch. */
export function markBatch(
  pubkey: string,
  batchId: number,
  relays: number,
  connected: number,
): void {
  const tr = traces.get(pubkey);
  if (!tr) return;
  tr.batchId = batchId;
  tr.batchRelays = relays;
  tr.batchConnected = connected;
}

/** The profile resolved (from memory, IDB, or a relay event). */
export function markResolved(
  pubkey: string,
  from: ResolveSource,
  name: string | undefined,
  relayUrl?: string,
): void {
  const tr = traces.get(pubkey);
  if (!tr) {
    // Resolved without an explicit request (e.g. arrived via pipeline). Record it
    // anyway so the trace is complete.
    traces.set(pubkey, {
      pubkey,
      requestedAt: now(),
      state: "resolved",
      resolvedFrom: from,
      resolvedAt: now(),
      resolvedRelay: relayUrl,
      name,
    });
    evictIfNeeded();
    return;
  }
  // First resolution wins for latency accounting; later updates just refresh name.
  if (tr.state !== "resolved") {
    tr.state = "resolved";
    tr.resolvedFrom = from;
    tr.resolvedAt = now();
    tr.resolvedRelay = relayUrl;
  }
  if (name) tr.name = name;
}

/** A batch timed out with this pubkey still unresolved. */
export function markTimeout(pubkey: string): void {
  const tr = traces.get(pubkey);
  if (!tr || tr.state === "resolved") return;
  tr.state = "timeout";
}

interface ProfileSummary {
  total: number;
  resolved: number;
  pending: number;
  timeout: number;
  fromMemory: number;
  fromIdb: number;
  fromRelay: number;
  fromBackend: number;
  avgResolveMs: number | null;
}

function summarize(): ProfileSummary {
  let resolved = 0,
    pending = 0,
    timeout = 0,
    fromMemory = 0,
    fromIdb = 0,
    fromRelay = 0,
    fromBackend = 0,
    latencySum = 0,
    latencyN = 0;
  for (const tr of traces.values()) {
    if (tr.state === "resolved") {
      resolved++;
      if (tr.resolvedFrom === "memory") fromMemory++;
      else if (tr.resolvedFrom === "idb") fromIdb++;
      else if (tr.resolvedFrom === "relay") fromRelay++;
      else if (tr.resolvedFrom === "backend") fromBackend++;
      if (tr.resolvedAt != null) {
        latencySum += tr.resolvedAt - tr.requestedAt;
        latencyN++;
      }
    } else if (tr.state === "timeout") timeout++;
    else pending++;
  }
  return {
    total: traces.size,
    resolved,
    pending,
    timeout,
    fromMemory,
    fromIdb,
    fromRelay,
    fromBackend,
    avgResolveMs: latencyN > 0 ? Math.round(latencySum / latencyN) : null,
  };
}

/**
 * Print a console.table of tracked profiles and return the summary.
 * @param filter optional: "pending" | "pend" | "timeout" | "unresolved" to
 *               narrow to the rows that matter for the bug.
 */
function report(filter?: string): ProfileSummary {
  const f = (filter ?? "").toLowerCase();
  const onlyUnresolved = f.startsWith("pend") || f === "timeout" || f === "unresolved";

  const rows = [...traces.values()]
    .filter((tr) => !onlyUnresolved || tr.state !== "resolved")
    .sort((a, b) => a.requestedAt - b.requestedAt)
    .map((tr) => ({
      pubkey: `${tr.pubkey.slice(0, 8)}…`,
      state: tr.state,
      name: tr.name ?? "—",
      idb: tr.idbResult ?? "—",
      from: tr.resolvedFrom ?? "—",
      relay: tr.resolvedRelay ? tr.resolvedRelay.replace(/^wss?:\/\//, "").replace(/\/$/, "") : "—",
      resolveMs:
        tr.resolvedAt != null ? Math.round(tr.resolvedAt - tr.requestedAt) : "—",
      batch: tr.batchId ?? "—",
    }));

  const summary = summarize();
  // eslint-disable-next-line no-console
  console.table(rows);
  // eslint-disable-next-line no-console
  console.info("[wiredDebug.profiles] summary:", summary);
  return summary;
}

/** Reset all traces (called on logout / account switch via profileCache.clear). */
export function resetProfileTracker(): void {
  traces.clear();
}

registerDebugCommand("profiles", (filter?: unknown) =>
  report(typeof filter === "string" ? filter : undefined),
);
