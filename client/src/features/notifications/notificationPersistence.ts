import { store } from "@/store";
import { restoreNotificationState, type NotificationPreferences, type SpaceMute, type ChannelNotifMode, type SpaceNotifSettings, type InAppNotification } from "@/store/slices/notificationSlice";
import { saveUserState, getUserState } from "@/lib/db/userStateStore";

const PREFS_KEY = "notification_preferences";
const STATE_KEY = "notification_unread_state";
const NOTIFS_KEY = "notification_items";
const DEBOUNCE_MS = 5_000;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

interface PersistedUnreadState {
  spaceUnread: Record<string, number>;
  channelUnread: Record<string, number>;
  spaceMentions: Record<string, number>;
  channelMentions: Record<string, number>;
  lastReadTimestamps: Record<string, number>;
  spaceMutes: Record<string, SpaceMute>;
  channelNotifSettings: Record<string, ChannelNotifMode>;
  spaceNotifSettings: Record<string, SpaceNotifSettings>;
}

// ── Preferences (IndexedDB via userStateStore for per-account isolation) ──────

export async function loadPreferences(): Promise<NotificationPreferences | null> {
  const prefs = await getUserState<NotificationPreferences>(PREFS_KEY);
  return prefs ?? null;
}

export async function savePreferences(prefs: NotificationPreferences): Promise<void> {
  await saveUserState(PREFS_KEY, prefs).catch(() => {});
}

// ── Unread state (IndexedDB via userStateStore) ─────────────────

export async function loadNotificationState(): Promise<void> {
  const [persisted, prefs, savedNotifs] = await Promise.all([
    getUserState<PersistedUnreadState>(STATE_KEY),
    loadPreferences(),
    getUserState<InAppNotification[]>(NOTIFS_KEY),
  ]);

  const payload: Partial<PersistedUnreadState & { preferences: NotificationPreferences; notifications: InAppNotification[] }> = {};

  if (persisted) {
    payload.spaceUnread = persisted.spaceUnread;
    payload.channelUnread = persisted.channelUnread;
    payload.spaceMentions = persisted.spaceMentions;
    payload.channelMentions = persisted.channelMentions;
    payload.lastReadTimestamps = persisted.lastReadTimestamps;
    payload.spaceMutes = persisted.spaceMutes;
    if (persisted.channelNotifSettings)
      (payload as Record<string, unknown>).channelNotifSettings = persisted.channelNotifSettings;
    if (persisted.spaceNotifSettings)
      (payload as Record<string, unknown>).spaceNotifSettings = persisted.spaceNotifSettings;
  }

  if (prefs) {
    payload.preferences = prefs;
  }

  const savedDismissed = await getUserState<string[]>("notification_dismissed_ids");

  if (savedNotifs?.length) {
    // Treat all persisted notifications as already-toasted so the toast stack
    // doesn't re-fire them on app open.
    payload.notifications = savedNotifs.map((n) =>
      n.toastShown ? n : { ...n, toastShown: true },
    );
  }
  if (savedDismissed?.length) {
    (payload as Record<string, unknown>).dismissedNotifIds = savedDismissed;
  }

  if (Object.keys(payload).length > 0) {
    store.dispatch(restoreNotificationState(payload));
  }
}

/** Cancel any pending debounced save (used during account switch) */
export function cancelPendingSave(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

/** Debounced save of unread state to IndexedDB */
export function scheduleSaveNotificationState(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    saveNotificationStateToDB();
  }, DEBOUNCE_MS);
}

function saveNotificationStateToDB(): void {
  const state = store.getState().notifications;
  const persisted: PersistedUnreadState = {
    spaceUnread: state.spaceUnread,
    channelUnread: state.channelUnread,
    spaceMentions: state.spaceMentions,
    channelMentions: state.channelMentions,
    lastReadTimestamps: state.lastReadTimestamps,
    spaceMutes: state.spaceMutes,
    channelNotifSettings: state.channelNotifSettings,
    spaceNotifSettings: state.spaceNotifSettings,
  };
  saveUserState(STATE_KEY, persisted).catch(() => {});
  savePreferences(state.preferences);
  // Persist notification items + dismissed IDs so state survives restart
  saveUserState(NOTIFS_KEY, state.notifications).catch(() => {});
  saveUserState("notification_dismissed_ids", state.dismissedNotifIds).catch(() => {});
}

/** Immediately flush any pending debounced save (used on app close / account switch) */
export function flushPendingSave(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  saveNotificationStateToDB();
}

/** Subscribe to Redux store changes and auto-persist */
export function startNotificationPersistence(): () => void {
  // Track the keys we care about via a simple fingerprint
  let lastFingerprint = "";

  const unsubscribe = store.subscribe(() => {
    const s = store.getState().notifications;
    const fingerprint = `${Object.keys(s.spaceUnread).length}:${Object.keys(s.channelUnread).length}:${Object.keys(s.spaceMutes).length}:${Object.keys(s.channelNotifSettings).length}:${Object.keys(s.spaceNotifSettings).length}:${Object.keys(s.lastReadTimestamps).length}:${s.preferences.enabled}:${s.preferences.dnd}:${s.notifications.length}:${s.notifications.filter(n => n.read).length}:${s.dismissedNotifIds.length}`;

    if (fingerprint !== lastFingerprint) {
      lastFingerprint = fingerprint;
      scheduleSaveNotificationState();
    }
  });

  // Flush pending save on app close to prevent debounce loss
  const handleBeforeUnload = () => flushPendingSave();
  window.addEventListener("beforeunload", handleBeforeUnload);

  return () => {
    unsubscribe();
    window.removeEventListener("beforeunload", handleBeforeUnload);
  };
}
