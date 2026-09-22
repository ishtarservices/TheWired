// Local DM privacy preferences (docs/DM_WIRE_CONTRACT.md §2): typing
// indicators and delivered/read receipts are best-effort, friends-only, and
// opt-out. Stored per device in localStorage; nothing about them is published.

const KEY = "thewired.dm.prefs";

export interface DMPrefs {
  /** Send typing rumors (kind 20014) while composing to a friend. */
  typing: boolean;
  /** Send delivered/read receipts (kind 20015) to friends. */
  receipts: boolean;
}

const DEFAULTS: DMPrefs = { typing: true, receipts: true };

let cache: DMPrefs | null = null;
const listeners = new Set<(p: DMPrefs) => void>();

export function getDMPrefs(): DMPrefs {
  if (cache) return cache;
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    const parsed = raw ? (JSON.parse(raw) as Partial<DMPrefs>) : {};
    cache = {
      typing: typeof parsed.typing === "boolean" ? parsed.typing : DEFAULTS.typing,
      receipts: typeof parsed.receipts === "boolean" ? parsed.receipts : DEFAULTS.receipts,
    };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

export function setDMPrefs(patch: Partial<DMPrefs>): DMPrefs {
  const next = { ...getDMPrefs(), ...patch };
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // private mode / quota — keep the in-memory value
  }
  for (const l of listeners) l(next);
  return next;
}

export function subscribeDMPrefs(listener: (p: DMPrefs) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test hook. */
export function __resetDMPrefsForTest(): void {
  cache = null;
}
