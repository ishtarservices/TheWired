import { Bell, BellOff, Clock } from "lucide-react";
import { useAppDispatch } from "../../store/hooks";
import { setPreferences } from "../../store/slices/notificationSlice";
import { useNotificationPreferences } from "../notifications/useNotifications";
import { requestBrowserPermission } from "../notifications/browserNotify";
import { savePreferences } from "../notifications/notificationPersistence";

const DND_DURATIONS = [
  { label: "1 hour", ms: 60 * 60 * 1000 },
  { label: "4 hours", ms: 4 * 60 * 60 * 1000 },
  { label: "8 hours", ms: 8 * 60 * 60 * 1000 },
  { label: "Permanent", ms: 0 },
];

interface ToggleProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function Toggle({ label, description, checked, onChange }: ToggleProps) {
  return (
    <div className="flex items-center justify-between py-3">
      <div>
        <div className="text-sm font-medium text-heading">{label}</div>
        <div className="text-xs text-muted">{description}</div>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
          checked ? "bg-pulse" : "bg-faint"
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
            checked ? "translate-x-4.5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

export function NotificationSettingsTab() {
  const dispatch = useAppDispatch();
  const prefs = useNotificationPreferences();

  const update = (key: string, value: boolean | number | undefined) => {
    const updated = { ...prefs, [key]: value };
    dispatch(setPreferences({ [key]: value }));
    savePreferences(updated);
  };

  async function handleBrowserToggle(enabled: boolean) {
    if (enabled) {
      const granted = await requestBrowserPermission();
      if (!granted) return;
    }
    update("browserNotifications", enabled);
  }

  function handleDndToggle(enabled: boolean) {
    if (enabled) {
      // Default to permanent
      dispatch(setPreferences({ dnd: true, dndUntil: undefined }));
    } else {
      dispatch(setPreferences({ dnd: false, dndUntil: undefined }));
    }
  }

  function handleDndDuration(ms: number) {
    if (ms === 0) {
      dispatch(setPreferences({ dnd: true, dndUntil: undefined }));
    } else {
      dispatch(setPreferences({ dnd: true, dndUntil: Date.now() + ms }));
    }
  }

  return (
    <div className="mx-auto w-full max-w-lg space-y-4">
      {/* Notification types */}
      <div className="rounded-lg border border-edge bg-panel p-4">
        <div className="mb-1 flex items-center gap-2">
          <Bell size={16} className="text-neon" />
          <h3 className="text-sm font-semibold text-heading">Notifications</h3>
        </div>
        <p className="mb-3 text-xs text-muted">
          Choose which events trigger notifications.
        </p>

        <div className="divide-y divide-edge">
          <Toggle
            label="Enable notifications"
            description="Master switch for all notifications"
            checked={prefs.enabled}
            onChange={(v) => update("enabled", v)}
          />
          <Toggle
            label="Mentions"
            description="When someone @mentions you in a space"
            checked={prefs.mentions}
            onChange={(v) => update("mentions", v)}
          />
          <Toggle
            label="Direct messages"
            description="When you receive a new DM"
            checked={prefs.dms}
            onChange={(v) => update("dms", v)}
          />
          <Toggle
            label="New followers"
            description="When someone follows you"
            checked={prefs.newFollowers}
            onChange={(v) => update("newFollowers", v)}
          />
          <Toggle
            label="Chat messages"
            description="Unread badges for new chat messages"
            checked={prefs.chatMessages}
            onChange={(v) => update("chatMessages", v)}
          />
          <Toggle
            label="Browser notifications"
            description="Show OS notifications when the app is in the background"
            checked={prefs.browserNotifications}
            onChange={handleBrowserToggle}
          />
          <Toggle
            label="Sound"
            description="Play a sound for new notifications"
            checked={prefs.sound}
            onChange={(v) => update("sound", v)}
          />
        </div>
      </div>

      {/* Do Not Disturb */}
      <div className="rounded-lg border border-edge bg-panel p-4">
        <div className="mb-1 flex items-center gap-2">
          <BellOff size={16} className="text-pulse" />
          <h3 className="text-sm font-semibold text-heading">Do Not Disturb</h3>
        </div>
        <p className="mb-3 text-xs text-muted">
          Silence all toasts and badges temporarily.
        </p>

        <Toggle
          label="Do Not Disturb"
          description={
            prefs.dnd
              ? prefs.dndUntil
                ? `Active until ${new Date(prefs.dndUntil).toLocaleTimeString()}`
                : "Active permanently"
              : "Disabled"
          }
          checked={prefs.dnd}
          onChange={handleDndToggle}
        />

        {prefs.dnd && (
          <div className="mt-2 flex flex-wrap gap-2">
            {DND_DURATIONS.map((d) => (
              <button
                key={d.label}
                onClick={() => handleDndDuration(d.ms)}
                className="flex items-center gap-1.5 rounded-lg border border-edge bg-card px-3 py-1.5 text-xs text-soft transition-colors hover:bg-card-hover hover:text-heading"
              >
                <Clock size={12} />
                {d.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
