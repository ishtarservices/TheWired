import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { subscriptionManager } from "../../lib/nostr/subscriptionManager";
import { EVENT_KINDS } from "../../types/nostr";

/** Debounce window for coalescing scroll-driven visibility changes before
 *  issuing an engagement REQ (matches the legacy useProfileEngagementSub value). */
const DEFAULT_DEBOUNCE_MS = 300;

/**
 * Tracks which note cards are currently in (or near) the viewport and fetches
 * reaction/repost/reply engagement for them — once each, in document order, as
 * they are revealed. This replaces the old "fetch engagement for the first 20
 * notes" hook, which silently skipped every note past page 1.
 *
 * Each note's engagement is fetched a single time when it first scrolls into
 * view; only the most-recently-revealed batch keeps a live subscription open,
 * so concurrent subs and #e filter size stay bounded no matter how far the user
 * scrolls. Pure (no React) so the core can be unit-tested directly.
 */
export class EngagementWindow {
  private visible = new Map<string, number>();
  private fetched = new Set<string>();
  private subId: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly relayUrls?: string[],
    private readonly debounceMs: number = DEFAULT_DEBOUNCE_MS,
  ) {}

  /** Report a card entering/leaving the viewport. `index` is its feed position,
   *  used only to fetch in document order. */
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
    // Close the previous batch's sub — its notes are already in the store; only
    // the freshest window needs live updates.
    if (this.subId) subscriptionManager.close(this.subId);
    // Single REQ, multiple filters (NIP-01 OR). No `limit`: chunking by viewport
    // is the volume control, and relays ignore client limits anyway.
    this.subId = subscriptionManager.subscribe({
      filters: [
        { kinds: [EVENT_KINDS.REACTION], "#e": ids },
        { kinds: [EVENT_KINDS.REPOST], "#e": ids },
        { kinds: [EVENT_KINDS.SHORT_TEXT], "#e": ids },
        { kinds: [EVENT_KINDS.ZAP_RECEIPT], "#e": ids },
      ],
      relayUrls: this.relayUrls,
    });
  }

  dispose(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.subId) {
      subscriptionManager.close(this.subId);
      this.subId = null;
    }
    this.visible.clear();
    this.fetched.clear();
  }
}

const Ctx = createContext<EngagementWindow | null>(null);

/** Provides an EngagementWindow to descendant note cards. One per feed/thread;
 *  fetched-state is scoped to this provider and torn down on unmount. */
export function EngagementCollectorProvider({
  relayUrls,
  children,
}: {
  relayUrls?: string[];
  children: ReactNode;
}) {
  const ref = useRef<EngagementWindow | null>(null);
  if (ref.current === null) ref.current = new EngagementWindow(relayUrls);

  useEffect(() => {
    const win = ref.current;
    return () => win?.dispose();
  }, []);

  return <Ctx.Provider value={ref.current}>{children}</Ctx.Provider>;
}

/** Attach to a note card's root element. Reports the card's viewport visibility
 *  (with a one-screen prefetch margin) to the surrounding EngagementWindow. */
export function useEngagementReporter(id: string, index: number) {
  const win = useContext(Ctx);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!win) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) win.report(id, index, entry.isIntersecting);
      },
      { rootMargin: "200px" }, // prefetch engagement ~one screen ahead
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      win.report(id, index, false);
    };
  }, [win, id, index]);

  return ref;
}
