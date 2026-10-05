/**
 * "Update Available" derivation + notification gating (WIR-165).
 *
 * The bug this pins: the banner showed for every re-delivered event and never
 * cleared. The client now derives the state from saved-vs-newest-known and the
 * notification is preference-gated, deduped per version, never for own items.
 */
import { describe, it, expect } from "vitest";
import type { MusicAlbum, SavedAlbumVersion } from "@/types/music";
import { createTestStore } from "@/__tests__/helpers/createTestStore";
import { login } from "@/store/slices/identitySlice";
import { addNotification, setPreferences, removeNotification } from "@/store/slices/notificationSlice";
import { hasPendingUpdate, newestKnownVersion, needsFetch, buildVersionFilters } from "../savedVersions";
import { planMusicUpdateNotification, musicUpdateNotificationId } from "../musicUpdateNotifier";

const ME = "a".repeat(64);
const ARTIST = "b".repeat(64);
const ADDR = `33123:${ARTIST}:ep`;
const E1 = "1".repeat(64);
const E2 = "2".repeat(64);
const E3 = "3".repeat(64);

function saved(over: Partial<SavedAlbumVersion> = {}): SavedAlbumVersion {
  return { addressableId: ADDR, savedEventId: E1, savedCreatedAt: 1000, hasUpdate: false, ...over };
}
function album(eventId: string, createdAt: number): Pick<MusicAlbum, "eventId" | "createdAt"> {
  return { eventId, createdAt };
}

describe("hasPendingUpdate", () => {
  it("is false with nothing saved", () => {
    expect(hasPendingUpdate(undefined, album(E1, 1000))).toBe(false);
  });

  it("is false when the local item IS the saved version (re-delivered event)", () => {
    expect(hasPendingUpdate(saved(), album(E1, 1000))).toBe(false);
  });

  it("is false for an older local item", () => {
    expect(hasPendingUpdate(saved({ savedEventId: E2, savedCreatedAt: 2000 }), album(E1, 1000))).toBe(false);
  });

  it("ignores a bare backend flag that carries no newer event (the legacy unconditional flag)", () => {
    expect(hasPendingUpdate(saved({ hasUpdate: true }), album(E1, 1000))).toBe(false);
    expect(hasPendingUpdate(saved({ hasUpdate: true, latestEventId: E1, latestCreatedAt: 1000 }), album(E1, 1000))).toBe(false);
  });

  it("is true when a strictly newer event is in Redux, even if the backend hasn't flagged yet", () => {
    expect(hasPendingUpdate(saved(), album(E2, 2000))).toBe(true);
  });

  it("is true when the backend knows a newer event the client hasn't received", () => {
    expect(hasPendingUpdate(saved({ hasUpdate: true, latestEventId: E2, latestCreatedAt: 2000 }), album(E1, 1000))).toBe(true);
    expect(hasPendingUpdate(saved({ hasUpdate: true, latestEventId: E2, latestCreatedAt: 2000 }), undefined)).toBe(true);
  });

  it("clears once the saved version is the newest known", () => {
    const after = saved({ savedEventId: E2, savedCreatedAt: 2000, latestEventId: null, latestCreatedAt: null });
    expect(hasPendingUpdate(after, album(E2, 2000))).toBe(false);
  });
});

describe("newestKnownVersion / needsFetch", () => {
  it("picks the newest of saved, backend-latest and local", () => {
    expect(newestKnownVersion(saved(), album(E1, 1000))).toEqual({ eventId: E1, createdAt: 1000 });
    expect(newestKnownVersion(saved({ latestEventId: E2, latestCreatedAt: 2000 }), album(E1, 1000))).toEqual({ eventId: E2, createdAt: 2000 });
    expect(newestKnownVersion(saved({ latestEventId: E2, latestCreatedAt: 2000 }), album(E3, 3000))).toEqual({ eventId: E3, createdAt: 3000 });
  });

  it("asks to fetch only when the backend's newer version is missing locally", () => {
    expect(needsFetch(saved(), album(E1, 1000))).toBe(false);
    expect(needsFetch(saved({ latestEventId: E2, latestCreatedAt: 2000 }), album(E1, 1000))).toBe(true);
    expect(needsFetch(saved({ latestEventId: E2, latestCreatedAt: 2000 }), undefined)).toBe(true);
    expect(needsFetch(saved({ latestEventId: E2, latestCreatedAt: 2000 }), album(E2, 2000))).toBe(false);
  });
});

describe("buildVersionFilters", () => {
  it("groups by kind:author with the smallest since and ignores malformed ids", () => {
    const filters = buildVersionFilters([
      { addressableId: `31683:${ARTIST}:one`, since: 500 },
      { addressableId: `31683:${ARTIST}:two:colon`, since: 300 },
      { addressableId: `33123:${ARTIST}:ep`, since: 900 },
      { addressableId: "garbage", since: 1 },
    ]);
    expect(filters).toEqual([
      { kinds: [31683], authors: [ARTIST], "#d": ["one", "two:colon"], since: 300 },
      { kinds: [33123], authors: [ARTIST], "#d": ["ep"], since: 900 },
    ]);
  });
});

describe("planMusicUpdateNotification", () => {
  const candidate = { addressableId: ADDR, authorPubkey: ARTIST, title: "EP", artist: "Luna", eventId: E2, createdAt: 2000 };

  function stateWith(prefs: Record<string, unknown> = {}, pubkey: string | null = ME) {
    const store = createTestStore();
    if (pubkey) store.dispatch(login({ pubkey, signerType: "nip07" }));
    store.dispatch(setPreferences(prefs));
    return store;
  }

  it("builds a project notification addressed to the item", () => {
    const n = planMusicUpdateNotification(stateWith().getState(), candidate);
    expect(n).toMatchObject({
      id: musicUpdateNotificationId(ADDR, E2),
      type: "music_update",
      title: "EP was updated",
      body: "Luna released a new version of this project.",
      contextId: ADDR,
      actorPubkey: ARTIST,
    });
  });

  it("says track for 31683 and falls back to 'The artist'", () => {
    const n = planMusicUpdateNotification(stateWith().getState(), { ...candidate, addressableId: `31683:${ARTIST}:t`, artist: "  " });
    expect(n?.body).toBe("The artist released a new version of this track.");
  });

  it("respects the musicUpdates toggle, the master switch and DND", () => {
    expect(planMusicUpdateNotification(stateWith({ musicUpdates: false }).getState(), candidate)).toBeNull();
    expect(planMusicUpdateNotification(stateWith({ enabled: false }).getState(), candidate)).toBeNull();
    expect(planMusicUpdateNotification(stateWith({ dnd: true }).getState(), candidate)).toBeNull();
    expect(planMusicUpdateNotification(stateWith({ dnd: true, dndUntil: Date.now() - 1 }).getState(), candidate)).not.toBeNull();
  });

  it("never fires for the user's own releases or when logged out", () => {
    expect(planMusicUpdateNotification(stateWith().getState(), { ...candidate, authorPubkey: ME })).toBeNull();
    expect(planMusicUpdateNotification(stateWith({}, null).getState(), candidate)).toBeNull();
  });

  it("is deduped per version by addNotification and stays dismissed", () => {
    const store = stateWith();
    const n = planMusicUpdateNotification(store.getState(), candidate)!;
    store.dispatch(addNotification(n));
    store.dispatch(addNotification({ ...n, timestamp: n.timestamp + 1 }));
    expect(store.getState().notifications.notifications).toHaveLength(1);
    // A newer version is a new notification…
    store.dispatch(addNotification(planMusicUpdateNotification(store.getState(), { ...candidate, eventId: E3 })!));
    expect(store.getState().notifications.notifications).toHaveLength(2);
    // …and a dismissed one does not come back when the event is re-delivered.
    store.dispatch(removeNotification(n.id));
    store.dispatch(addNotification(n));
    expect(store.getState().notifications.notifications.map((x) => x.id)).toEqual([musicUpdateNotificationId(ADDR, E3)]);
  });
});
