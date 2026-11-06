import { sql } from "drizzle-orm";
import { db } from "../db/connection.js";
import { accountClients, type AccountClientKind } from "../db/schema/accountClients.js";

/**
 * X-Wired-Client: which of our apps an authenticated request came from.
 *
 *   X-Wired-Client: <client>/<semver>[ (<platform>)]
 *   e.g.  desktop/0.7.2 (macos)   mobile/1.3.0 (ios)   mobile/1.3.0-beta.2
 *
 * The value is client-supplied and only informational: it is recorded against
 * the gateway-verified pubkey, never trusted for authorization, and carries no
 * account reference of its own. Anything outside the grammar is ignored
 * silently (never logged: the raw value is untrusted input). External Nostr
 * clients never send it, which is exactly what the activity report uses.
 */
export const WIRED_CLIENT_HEADER = "x-wired-client";
/** Whole header value, bytes. */
export const WIRED_CLIENT_MAX_LENGTH = 64;
/** At most one row write per pubkey+client+platform in this window. */
export const ACCOUNT_CLIENT_WRITE_INTERVAL_MS = 10 * 60_000;
/** Throttle entries kept in memory; the oldest goes when a new one arrives. */
export const ACCOUNT_CLIENT_THROTTLE_MAX = 50_000;
const WARN_INTERVAL_MS = 60_000;

/**
 * Platform tokens each app may report ("" = none given). Anything else is
 * ignored: the token is part of the row key and the write throttle, so an
 * open set would let one account mint unbounded rows.
 */
const KNOWN_PLATFORMS: ReadonlyMap<string, ReadonlySet<string>> = new Map<AccountClientKind, ReadonlySet<string>>([
  ["desktop", new Set(["", "macos", "windows", "linux", "unknown"])],
  ["mobile", new Set(["", "ios", "android"])],
]);
// semver 2.0 core + optional pre-release / build, ASCII only.
const SEMVER = "(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?";
const HEADER_RE = new RegExp(`^([a-z]+)/(${SEMVER})(?: \\(([a-z0-9_-]{1,16})\\))?$`);

export interface ParsedWiredClient {
  client: AccountClientKind;
  version: string;
  platform: string;
}

export function parseWiredClient(value: string | undefined): ParsedWiredClient | null {
  if (!value || value.length > WIRED_CLIENT_MAX_LENGTH) return null;
  const m = HEADER_RE.exec(value);
  if (!m) return null;
  const platforms = KNOWN_PLATFORMS.get(m[1]);
  const platform = m[3] ?? "";
  if (!platforms || !platforms.has(platform)) return null;
  return { client: m[1] as AccountClientKind, version: m[2], platform };
}

/**
 * Bounded "last write at" map. Keys are refreshed on every write, so Map
 * insertion order is recency order and the first key is the stalest; when
 * full, that one is dropped (a flood of distinct pubkeys can't grow it).
 */
export class WriteThrottle {
  private readonly lastWriteAt = new Map<string, number>();

  constructor(
    private readonly maxEntries: number,
    private readonly intervalMs: number,
  ) {}

  /** True (and the key is marked) when a write is due; false inside the window. */
  acquire(key: string, now: number): boolean {
    const last = this.lastWriteAt.get(key);
    if (last !== undefined && now - last < this.intervalMs) return false;
    if (last !== undefined) this.lastWriteAt.delete(key);
    else if (this.lastWriteAt.size >= this.maxEntries) {
      const oldest = this.lastWriteAt.keys().next().value;
      if (oldest !== undefined) this.lastWriteAt.delete(oldest);
    }
    this.lastWriteAt.set(key, now);
    return true;
  }

  /** Forget a key so the next request retries (used when the write failed). */
  release(key: string): void {
    this.lastWriteAt.delete(key);
  }

  has(key: string): boolean {
    return this.lastWriteAt.has(key);
  }

  get size(): number {
    return this.lastWriteAt.size;
  }

  clear(): void {
    this.lastWriteAt.clear();
  }
}

const throttle = new WriteThrottle(ACCOUNT_CLIENT_THROTTLE_MAX, ACCOUNT_CLIENT_WRITE_INTERVAL_MS);
const inflight = new Set<Promise<void>>();
let lastWarnAt = 0;

/**
 * Upsert the (pubkey, client, platform) row unless one was written in the
 * last ACCOUNT_CLIENT_WRITE_INTERVAL_MS. Fire-and-forget: the request never
 * waits on it. Returns whether a write was scheduled.
 */
export function recordAccountClient(pubkey: string, header: string | undefined, now = Date.now()): boolean {
  const parsed = parseWiredClient(header);
  if (!parsed) return false;
  const key = `${pubkey}:${parsed.client}:${parsed.platform}`;
  if (!throttle.acquire(key, now)) return false;

  const write = db
    .insert(accountClients)
    .values({ pubkey, client: parsed.client, platform: parsed.platform, version: parsed.version })
    .onConflictDoUpdate({
      target: [accountClients.pubkey, accountClients.client, accountClients.platform],
      set: { version: parsed.version, lastSeen: sql`now()` },
    })
    .then(
      () => undefined,
      (err: unknown) => {
        throttle.release(key);
        const t = Date.now();
        if (t - lastWarnAt >= WARN_INTERVAL_MS) {
          lastWarnAt = t;
          console.warn(`[accountClients] upsert failed: ${err instanceof Error ? err.message : "error"}`);
        }
      },
    );
  inflight.add(write);
  void write.finally(() => inflight.delete(write));
  return true;
}

/** Tests: wait for every scheduled write to settle. */
export async function flushAccountClientWrites(): Promise<void> {
  await Promise.all([...inflight]);
}

/** Tests: forget the throttle state. */
export function resetAccountClientThrottle(): void {
  throttle.clear();
}
