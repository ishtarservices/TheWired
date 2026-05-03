const STORAGE_KEY = "thewired_zoom";

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2.0;
export const ZOOM_STEP = 0.1;
export const ZOOM_DEFAULT = 1.0;

type Listener = (zoom: number) => void;

let currentZoom = ZOOM_DEFAULT;
const listeners = new Set<Listener>();

function clamp(z: number): number {
  if (!Number.isFinite(z)) return ZOOM_DEFAULT;
  const rounded = Math.round(z * 100) / 100;
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, rounded));
}

function apply(z: number) {
  // CSS `zoom` on documentElement scales the entire web content like browser
  // zoom. Native window chrome (overlay title bar) stays at 1×, which is what
  // we want — traffic lights shouldn't grow.
  document.documentElement.style.zoom = z === 1 ? "" : String(z);
}

export function getZoom(): number {
  return currentZoom;
}

export function setZoom(z: number) {
  const next = clamp(z);
  if (next === currentZoom) {
    // Still notify so the indicator can blink at min/max edges.
    listeners.forEach((fn) => fn(next));
    return;
  }
  currentZoom = next;
  apply(next);
  try {
    if (next === ZOOM_DEFAULT) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, String(next));
  } catch {
    // localStorage unavailable; zoom still applies for the session
  }
  listeners.forEach((fn) => fn(next));
}

export function increaseZoom() {
  setZoom(currentZoom + ZOOM_STEP);
}

export function decreaseZoom() {
  setZoom(currentZoom - ZOOM_STEP);
}

export function resetZoom() {
  setZoom(ZOOM_DEFAULT);
}

export function subscribeZoom(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Read persisted zoom and apply synchronously. Call once before render to
 * avoid a flash of unzoomed content on startup.
 */
export function initZoom() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = parseFloat(raw);
    if (Number.isFinite(parsed)) {
      currentZoom = clamp(parsed);
      apply(currentZoom);
    }
  } catch {
    // ignore
  }
}
