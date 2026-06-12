/**
 * Gated, structured debug logger for diagnosing event / fetch / profile flows.
 *
 * Why this exists: profiles sometimes render as a raw pubkey instead of a name.
 * That can be an IndexedDB miss, a relay that never connected in time, a batch
 * that timed out, a stale-event reject, or a parse failure. To tell them apart
 * we need a timestamped trace of the whole pipeline that can be exported and
 * shared. This module is that trace.
 *
 * Production-safe by construction:
 * - `debug`/`info` route through `console.debug`/`console.info`, which Terser
 *   strips in prod builds via `pure_funcs` in vite.config.ts. `warn`/`error`
 *   always pass through (matching the project's minimal-logging convention).
 * - In dev, every category is ON by default. Toggle at runtime from the console:
 *       wiredDebug.enable()                // all categories
 *       wiredDebug.enable("profile,relay") // only these
 *       wiredDebug.disable()               // silence + stop recording
 *       wiredDebug.status()
 *   The choice persists in localStorage under "wired:debug".
 * - All emitted lines (including warn/error) are kept in an in-memory ring
 *   buffer so `wiredDebug.dump()` can export a full trace for sharing.
 */

export type LogCategory =
  | "startup"
  | "identity"
  | "relay"
  | "sub"
  | "outbox" // persistent publish outbox: queue/replay/ack
  | "pipeline"
  | "profile"
  | "idb"
  | "spaces"
  | "zap"
  | "nwc"
  | "lnurl"
  | "nav"   // route changes, navigation timing, current-account context
  | "perf"  // main-thread health (event-loop lag spikes)
  | "latency" // per-message receive latency, by relay (chat delivery timing)
  | "feed"  // profile / space feed throughput (note arrivals, LoadMore)
  | "call"; // voice/video: RTC signaling, ICE, LiveKit tracks, audio attach

type LogLevel = "debug" | "info" | "warn" | "error";

const CATEGORY_COLORS: Record<LogCategory, string> = {
  startup: "#a78bfa",
  identity: "#f472b6",
  relay: "#38bdf8",
  sub: "#22d3ee",
  outbox: "#2dd4bf",
  pipeline: "#fbbf24",
  profile: "#34d399",
  idb: "#94a3b8",
  spaces: "#fb923c",
  zap: "#facc15",
  nwc: "#f59e0b",
  lnurl: "#fde047",
  nav: "#c084fc",
  perf: "#ef4444",
  latency: "#e879f9",
  feed: "#10b981",
  call: "#4ade80",
};

const LS_KEY = "wired:debug";
const RING_CAPACITY = 8000;

/** High-resolution session clock so every line is `+<seconds>` since app load. */
const SESSION_START =
  typeof performance !== "undefined" ? performance.now() : Date.now();

interface LogEntry {
  /** ms since session start */
  t: number;
  /** wall-clock ISO time (for correlating with a screen recording) */
  wall: string;
  cat: LogCategory;
  level: LogLevel;
  msg: string;
  data?: unknown;
}

const ring: LogEntry[] = [];

/**
 * Enabled state. `null` = nothing, "all" = every category, otherwise a set.
 * Resolved from localStorage, falling back to DEV default.
 */
let enabled: "all" | Set<LogCategory> | null = resolveInitialState();

function resolveInitialState(): "all" | Set<LogCategory> | null {
  let raw: string | null = null;
  try {
    raw = typeof localStorage !== "undefined" ? localStorage.getItem(LS_KEY) : null;
  } catch {
    raw = null;
  }
  // Off by default (warn/error always print). Opt in with wiredDebug.enable(...);
  // the choice persists in localStorage, so it survives reloads while debugging.
  if (raw == null) return null;
  return parseSetting(raw);
}

function parseSetting(raw: string): "all" | Set<LogCategory> | null {
  const v = raw.trim().toLowerCase();
  if (v === "" || v === "off" || v === "false" || v === "0" || v === "none") return null;
  if (v === "*" || v === "all" || v === "true" || v === "1") return "all";
  const set = new Set<LogCategory>();
  for (const part of v.split(/[,\s]+/)) {
    if (part) set.add(part as LogCategory);
  }
  return set.size > 0 ? set : null;
}

function persist(): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (enabled === null) localStorage.setItem(LS_KEY, "off");
    else if (enabled === "all") localStorage.setItem(LS_KEY, "*");
    else localStorage.setItem(LS_KEY, [...enabled].join(","));
  } catch {
    /* localStorage unavailable (private mode / SSR) — keep in-memory only */
  }
}

function isCategoryEnabled(cat: LogCategory): boolean {
  if (enabled === null) return false;
  if (enabled === "all") return true;
  return enabled.has(cat);
}

function record(entry: LogEntry): void {
  ring.push(entry);
  if (ring.length > RING_CAPACITY) ring.shift();
}

function emit(cat: LogCategory, level: LogLevel, msg: string, data?: unknown): void {
  // warn/error are always recorded + printed. debug/info gate on category.
  const important = level === "warn" || level === "error";
  const active = important || isCategoryEnabled(cat);
  if (!active) return;

  const t = (typeof performance !== "undefined" ? performance.now() : Date.now()) - SESSION_START;
  record({
    t,
    wall: new Date().toISOString(),
    cat,
    level,
    msg,
    data,
  });

  const tag = `+${(t / 1000).toFixed(2)}s`;
  const prefix = `%c${tag}%c [${cat}] ${msg}`;
  const timeStyle = "color:#64748b";
  const catStyle = `color:${CATEGORY_COLORS[cat] ?? "#e2e8f0"};font-weight:600`;

  const fn =
    level === "error"
      ? console.error
      : level === "warn"
        ? console.warn
        : level === "info"
          ? console.info
          : console.debug;

  if (data !== undefined) {
    fn(prefix, timeStyle, catStyle, data);
  } else {
    fn(prefix, timeStyle, catStyle);
  }
}

export interface Logger {
  debug(msg: string, data?: unknown): void;
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
  error(msg: string, data?: unknown): void;
  /** Start a stopwatch; the returned fn logs elapsed ms when called. */
  time(label: string): (data?: unknown) => void;
}

/** Create a category-bound logger. Cheap — call at module scope. */
export function createLogger(cat: LogCategory): Logger {
  return {
    debug: (msg, data) => emit(cat, "debug", msg, data),
    info: (msg, data) => emit(cat, "info", msg, data),
    warn: (msg, data) => emit(cat, "warn", msg, data),
    error: (msg, data) => emit(cat, "error", msg, data),
    time: (label) => {
      const start = typeof performance !== "undefined" ? performance.now() : Date.now();
      return (data) => {
        const ms = (typeof performance !== "undefined" ? performance.now() : Date.now()) - start;
        emit(cat, "debug", `${label} took ${ms.toFixed(0)}ms`, data);
      };
    },
  };
}

/** Short pubkey for log lines: first 8 hex chars. */
export function shortKey(pubkey: string | null | undefined): string {
  if (!pubkey) return "(none)";
  return pubkey.length > 12 ? `${pubkey.slice(0, 8)}…` : pubkey;
}

/** Short relay label: strip scheme + trailing slash. */
export function shortRelay(url: string): string {
  return url.replace(/^wss?:\/\//, "").replace(/\/$/, "");
}

// ---------------------------------------------------------------------------
// window.wiredDebug console API
// ---------------------------------------------------------------------------

interface DumpOptions {
  /** Only include these categories. */
  cats?: LogCategory[];
  /** Only include entries at/after this many seconds since session start. */
  sinceSec?: number;
  /** Minimum level. */
  level?: LogLevel;
}

const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function formatRing(opts: DumpOptions = {}): string {
  const minRank = opts.level ? LEVEL_RANK[opts.level] : 0;
  const catFilter = opts.cats ? new Set(opts.cats) : null;
  const sinceMs = opts.sinceSec != null ? opts.sinceSec * 1000 : 0;

  const lines = ring
    .filter(
      (e) =>
        LEVEL_RANK[e.level] >= minRank &&
        (!catFilter || catFilter.has(e.cat)) &&
        e.t >= sinceMs,
    )
    .map((e) => {
      const tag = `+${(e.t / 1000).toFixed(2)}s`.padStart(9);
      const lvl = e.level.toUpperCase().padEnd(5);
      const cat = `[${e.cat}]`.padEnd(11);
      let line = `${tag} ${lvl} ${cat} ${e.msg}`;
      if (e.data !== undefined) {
        let dataStr: string;
        try {
          dataStr = JSON.stringify(e.data);
        } catch {
          dataStr = String(e.data);
        }
        line += `  ${dataStr}`;
      }
      return line;
    });

  return lines.join("\n");
}

export interface WiredDebugApi {
  /** Enable logging. Pass nothing for all categories, or a comma list. */
  enable(cats?: string): void;
  /** Disable all logging + recording (warn/error still print). */
  disable(): void;
  /** Print current enabled state + buffer size. */
  status(): void;
  /** Export the recorded trace as a string (also copied to clipboard if possible). */
  dump(opts?: DumpOptions): string;
  /** Clear the ring buffer. */
  clear(): void;
  /** Print a snapshot of current relay connections. */
  relays(): void;
  /** Print categories + available commands. */
  help(): void;
  /** Snapshot: account, top subs by event count, recent main-thread lag spikes, relays. */
  session(): void;
  /** Allow other modules (e.g. profileTracker) to attach commands. */
  [key: string]: unknown;
}

function buildApi(): WiredDebugApi {
  return {
    enable(cats?: string) {
      enabled = cats ? parseSetting(cats) ?? "all" : "all";
      persist();
      // eslint-disable-next-line no-console
      console.info(
        `[wiredDebug] enabled: ${enabled === "all" ? "all categories" : [...(enabled as Set<LogCategory>)].join(", ")}`,
      );
    },
    disable() {
      enabled = null;
      persist();
      // eslint-disable-next-line no-console
      console.info("[wiredDebug] disabled (warn/error still print)");
    },
    status() {
      const state = enabled === null ? "off" : enabled === "all" ? "all" : [...enabled].join(", ");
      // eslint-disable-next-line no-console
      console.info(`[wiredDebug] state=${state} buffered=${ring.length} entries`);
    },
    dump(opts?: DumpOptions) {
      const out = formatRing(opts);
      try {
        navigator.clipboard?.writeText(out).then(
          () => console.info(`[wiredDebug] ${ring.length} entries copied to clipboard`),
          () => {},
        );
      } catch {
        /* clipboard unavailable */
      }
      return out;
    },
    clear() {
      ring.length = 0;
      // eslint-disable-next-line no-console
      console.info("[wiredDebug] buffer cleared");
    },
    relays() {
      // Lazy import to avoid a circular dependency at module load.
      void import("../nostr/relayManager").then(({ relayManager }) => {
        const rows = [...relayManager.getAllConnections().values()].map((c) => ({
          relay: shortRelay(c.url),
          status: c.getStatus(),
          mode: c.mode,
          latencyMs: c.getLatency(),
          events: c.getEventCount(),
        }));
        // eslint-disable-next-line no-console
        console.table(rows);
      });
    },
    help() {
      // eslint-disable-next-line no-console
      console.info(
        [
          "[wiredDebug] off by default — warn/error always print. Commands:",
          '  enable()                  — log all categories',
          '  enable("profile,relay")   — only these categories',
          "  disable()                 — silence (clears the localStorage opt-in)",
          "  status()                  — current state + buffered entry count",
          '  profiles("pending")       — profile resolution table (omit arg for all)',
          "  relays()                  — relay connection snapshot",
          "  session()                 — snapshot: account + top subs + recent lag spikes + relays",
          "  calls()                   — voice/call snapshot: state, PC + ICE stats, tracks, LiveKit room",
          "  dump({cats,level,sinceSec}) — export recent trace (also copies to clipboard)",
          "  clear()                   — clear the trace buffer",
          "  categories: startup, identity, relay, sub, pipeline, profile, idb, spaces,",
          "              nav, perf, feed, zap, nwc, lnurl, call",
        ].join("\n"),
      );
    },
    session() {
      // Lazy imports to avoid module-load circular deps.
      void Promise.all([
        import("../nostr/relayManager"),
        import("../nostr/subscriptionManager"),
        import("./perfMonitor"),
        import("../../store"),
      ]).then(([{ relayManager }, { subscriptionManager }, { getRecentLagSpikes }, { store }]) => {
        const state = store.getState();
        const pubkey = state.identity.pubkey as string | null;
        const path = typeof location !== "undefined" ? location.pathname : "?";
        // eslint-disable-next-line no-console
        console.info(
          `[wiredDebug.session]\n  account : ${pubkey ? `${pubkey.slice(0, 12)}…` : "(none)"}\n  route   : ${path}`,
        );

        // Active subs ranked by event count — the high-volume ones drive load.
        const subs = [...subscriptionManager.getAllSubscriptions().values()]
          .map((s) => {
            const kinds = [...new Set(s.filters.flatMap((f) => f.kinds ?? []))].join(",");
            return {
              id: s.id.slice(0, 10),
              kinds: kinds || "(any)",
              events: s.eventCount,
              ageSec: ((Date.now() - s.createdAt) / 1000).toFixed(1),
              relays: s.relayUrls.length,
              eosed: s.eoseFired,
            };
          })
          .sort((a, b) => b.events - a.events)
          .slice(0, 10);
        // eslint-disable-next-line no-console
        console.info(`  top subs (showing ${subs.length} of ${subscriptionManager.getActiveCount()} active):`);
        // eslint-disable-next-line no-console
        console.table(subs);

        const spikes = getRecentLagSpikes();
        if (spikes.length > 0) {
          const recent = spikes.slice(-10).map((s) => ({
            atSec: (s.t / 1000).toFixed(2),
            lagMs: Math.round(s.lagMs),
          }));
          // eslint-disable-next-line no-console
          console.info(`  recent main-thread lag spikes (${recent.length} of ${spikes.length}):`);
          // eslint-disable-next-line no-console
          console.table(recent);
        } else {
          // eslint-disable-next-line no-console
          console.info("  recent main-thread lag spikes: none (>150ms)");
        }

        const conns = [...relayManager.getAllConnections().values()].map((c) => ({
          relay: shortRelay(c.url),
          status: c.getStatus(),
          mode: c.mode,
          events: c.getEventCount(),
        }));
        // eslint-disable-next-line no-console
        console.info(`  relays (${conns.length}):`);
        // eslint-disable-next-line no-console
        console.table(conns);
      });
    },
  };
}

declare global {
  interface Window {
    wiredDebug?: WiredDebugApi;
  }
}

/** Install (or return the existing) window.wiredDebug API. Idempotent. */
export function installWiredDebug(): WiredDebugApi {
  if (typeof window === "undefined") return buildApi();
  if (!window.wiredDebug) {
    window.wiredDebug = buildApi();
  }
  return window.wiredDebug;
}

/** Register an extra command on window.wiredDebug (used by profileTracker). */
export function registerDebugCommand(name: string, fn: (...args: unknown[]) => unknown): void {
  const api = installWiredDebug();
  api[name] = fn;
}

// Install eagerly so the console API exists from the first import.
installWiredDebug();
