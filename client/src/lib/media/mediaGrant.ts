// The viewer's media grant (docs/MEDIA_STORAGE.md §4): a weekly token our
// server accepts as `?tk=` on members-only space blobs. One NIP-98 mint per
// session (deduped), held in memory with a synchronous getter so the parse
// chokepoints can tokenize URLs without awaiting. Components re-render through
// `useMediaGrant` when it arrives or changes.

import { useSyncExternalStore } from "react";
import { getApiBaseUrl } from "@/lib/api/client";
import { buildAuthHeaders } from "@/lib/api/nip98";

const WEEK_SEC = 604_800;
/** A failed mint isn't retried from render paths for this long. */
const FAILURE_BACKOFF_MS = 30_000;
/** `forceRefresh` after a load error re-mints at most this often. */
const FORCE_REFRESH_MIN_MS = 30_000;

interface Grant {
  token: string;
  exp: number;
}

let grant: Grant | null = null;
let inflight: Promise<string | null> | null = null;
let lastMintAt = 0;
let failedAt = 0;
/** Bumped on clear: a mint started for a previous account is discarded. */
let generation = 0;
let version = 0;
const listeners = new Set<() => void>();

function notify(): void {
  version++;
  for (const l of listeners) l();
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/** The `exp` our server issues at `now` (contract §4): the end of next week. */
export function currentGrantExp(now: number = nowSec()): number {
  return (Math.floor(now / WEEK_SEC) + 2) * WEEK_SEC;
}

/** A grant minted in an earlier week is re-minted (its exp is below what the
 *  server would issue now), keeping the URL stable within a week. */
export function grantNeedsRefresh(exp: number, now: number = nowSec()): boolean {
  return exp < currentGrantExp(now);
}

async function mint(): Promise<string | null> {
  const gen = generation;
  const url = `${getApiBaseUrl()}/media-grant`;
  try {
    const headers = await buildAuthHeaders(url, "GET");
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`media-grant ${res.status}`);
    const json = (await res.json()) as { data?: unknown } & Record<string, unknown>;
    const body = (json.data ?? json) as { token?: unknown; exp?: unknown };
    if (typeof body.token !== "string" || typeof body.exp !== "number") throw new Error("bad grant");
    if (gen !== generation) return null; // account switched mid-mint
    grant = { token: body.token, exp: body.exp };
    lastMintAt = Date.now();
    failedAt = 0;
    notify();
    return grant.token;
  } catch {
    if (gen === generation) failedAt = Date.now();
    return null;
  }
}

function startMint(): Promise<string | null> {
  if (inflight) return inflight;
  const p = mint().finally(() => {
    if (inflight === p) inflight = null;
  });
  inflight = p;
  return p;
}

/**
 * The current grant token, or null when there is none yet. Never blocks:
 * a missing or last-week grant starts a background mint (subscribers are
 * notified when it lands). A still-unexpired token is returned meanwhile.
 */
export function getMediaGrant(): string | null {
  const now = nowSec();
  const usable = grant && grant.exp > now ? grant.token : null;
  const stale = !grant || grantNeedsRefresh(grant.exp, now);
  if (stale && !inflight && Date.now() - failedAt >= FAILURE_BACKOFF_MS) void startMint();
  return usable;
}

/** Resolve to a fresh grant, minting if needed (deduped). */
export function ensureMediaGrant(): Promise<string | null> {
  if (grant && !grantNeedsRefresh(grant.exp)) return Promise.resolve(grant.token);
  return startMint();
}

/**
 * Re-mint after a media load error (an element can't see the 401/404). Rate
 * limited: within a short window it resolves to the current grant instead.
 */
export function forceRefreshMediaGrant(): Promise<string | null> {
  if (inflight) return inflight;
  if (grant && Date.now() - lastMintAt < FORCE_REFRESH_MIN_MS) return Promise.resolve(grant.token);
  return startMint();
}

/** The held token, with no side effects (no background mint). */
export function peekMediaGrant(): string | null {
  return grant?.token ?? null;
}

/** Drop the grant (account switch / logout). */
export function clearMediaGrant(): void {
  generation++;
  grant = null;
  inflight = null;
  lastMintAt = 0;
  failedAt = 0;
  notify();
}

export function subscribeMediaGrant(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Re-render when the grant changes; returns the current token. */
export function useMediaGrant(): string | null {
  useSyncExternalStore(subscribeMediaGrant, () => version);
  return grant?.token ?? null;
}
