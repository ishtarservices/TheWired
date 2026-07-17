// Viewport-windowed engagement fetching — near-verbatim port of the desktop
// EngagementWindow (client/src/features/profile/engagementCollector.tsx).
// Cards report enter/leave viewport; reports debounce 300ms so scroll bursts
// coalesce into ONE REQ; each note's engagement is fetched once ever (per
// mount); only the freshest batch keeps a live sub. Deliberate deltas from
// desktop: the subscriptionManager dependency is an injected seam (the
// engine's fixed-sub-id filter replacement gives "close the previous batch"
// for free, so there's no subId bookkeeping), no relayUrls param (one
// 3-socket pool), and the IntersectionObserver half is replaced by FlatList
// viewability callbacks at the screen. Pure (no React) — unit-tested direct.

/** Debounce window for coalescing scroll-driven visibility changes before
 *  issuing an engagement REQ (desktop parity). */
const DEFAULT_DEBOUNCE_MS = 300;

export interface EngagementSubscriber {
  /** Fixed-sub-id REQ for a batch of note ids; calling again replaces the
   *  filters — the previous batch's sub closes implicitly. */
  subscribeEngagement(ids: string[]): void;
  unsubscribeEngagement(): void;
}

export class EngagementWindow {
  private visible = new Map<string, number>();
  private fetched = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly sub: EngagementSubscriber,
    private readonly debounceMs: number = DEFAULT_DEBOUNCE_MS,
  ) {}

  /** Report a card entering/leaving the viewport. `index` is its feed
   *  position, used only to fetch in feed order. */
  report(id: string, index: number, isVisible: boolean): void {
    if (isVisible) this.visible.set(id, index);
    else this.visible.delete(id);
    if (this.timer === null) {
      this.timer = setTimeout(() => this.flush(), this.debounceMs);
    }
  }

  /** Fetch engagement for any newly-revealed notes. Exposed for tests. */
  flush(): void {
    this.timer = null;
    const ids = [...this.visible.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([id]) => id)
      .filter((id) => !this.fetched.has(id));
    if (ids.length === 0) return;
    for (const id of ids) this.fetched.add(id);
    this.sub.subscribeEngagement(ids);
  }

  dispose(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.sub.unsubscribeEngagement();
    this.visible.clear();
    this.fetched.clear();
  }
}
