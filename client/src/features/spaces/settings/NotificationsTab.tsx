import { useAppDispatch } from "../../../store/hooks";
import {
  setSpaceMute,
  removeSpaceMute,
  setSpaceNotifSettings,
  setChannelNotifMode,
  type ChannelNotifMode,
} from "../../../store/slices/notificationSlice";
import {
  useSpaceMuted,
  useSpaceNotifSettings,
  useChannelNotifMode as useChannelMode,
} from "../../notifications/useNotifications";
import { useSpaceChannels } from "../useSpaceChannels";

const MUTE_DURATIONS = [
  { label: "1 hour", ms: 60 * 60 * 1000 },
  { label: "8 hours", ms: 8 * 60 * 60 * 1000 },
  { label: "24 hours", ms: 24 * 60 * 60 * 1000 },
  { label: "Permanent", ms: 0 },
];

const CHANNEL_MODES: { value: ChannelNotifMode; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "all", label: "All Messages" },
  { value: "mentions", label: "Mentions Only" },
  { value: "nothing", label: "Nothing" },
  { value: "muted", label: "Muted" },
];

interface NotificationsTabProps {
  spaceId: string;
}

export function NotificationsTab({ spaceId }: NotificationsTabProps) {
  const dispatch = useAppDispatch();
  const isMuted = useSpaceMuted(spaceId);
  const settings = useSpaceNotifSettings(spaceId);
  const { channels } = useSpaceChannels(spaceId);

  const mode = settings?.mode ?? "all";
  const suppressEveryone = settings?.suppressEveryone ?? false;
  const suppressRoleMentions = settings?.suppressRoleMentions ?? false;

  function updateSettings(patch: Partial<{ mode: "all" | "mentions" | "nothing"; suppressEveryone: boolean; suppressRoleMentions: boolean }>) {
    dispatch(setSpaceNotifSettings({
      spaceId,
      settings: {
        mode,
        suppressEveryone,
        suppressRoleMentions,
        ...patch,
      },
    }));
  }

  function handleMute(ms: number) {
    const muteUntil = ms > 0 ? Date.now() + ms : undefined;
    dispatch(setSpaceMute({ spaceId, mute: { muted: true, muteUntil } }));
  }

  function handleUnmute() {
    dispatch(removeSpaceMute(spaceId));
  }

  return (
    <div className="space-y-6">
      <h3 className="text-sm font-semibold text-heading">Notifications</h3>

      {/* Mute Space */}
      <Section title="Mute Space" description="Disable all notifications from this space.">
        {isMuted ? (
          <button
            onClick={handleUnmute}
            className="rounded-xl bg-primary/10 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/20 transition-colors"
          >
            Unmute Space
          </button>
        ) : (
          <div className="flex flex-wrap gap-2">
            {MUTE_DURATIONS.map((d) => (
              <button
                key={d.label}
                onClick={() => handleMute(d.ms)}
                className="rounded-xl bg-surface px-3 py-1.5 text-xs text-body hover:bg-surface-hover hover:text-heading transition-colors"
              >
                {d.label}
              </button>
            ))}
          </div>
        )}
      </Section>

      {/* Notification Mode */}
      <Section title="Default Notification Mode" description="Set the default for all channels in this space.">
        <div className="space-y-1">
          {(["all", "mentions", "nothing"] as const).map((m) => (
            <label
              key={m}
              className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-surface-hover transition-colors cursor-pointer"
            >
              <input
                type="radio"
                name="space-notif-mode"
                checked={mode === m}
                onChange={() => updateSettings({ mode: m })}
                className="accent-primary"
              />
              <div>
                <div className="text-sm text-heading capitalize">{m === "all" ? "All Messages" : m === "mentions" ? "Mentions Only" : "Nothing"}</div>
                <div className="text-[10px] text-muted">
                  {m === "all" && "Notified for every message"}
                  {m === "mentions" && "Only notified for @mentions"}
                  {m === "nothing" && "No notifications, unread dot only"}
                </div>
              </div>
            </label>
          ))}
        </div>
      </Section>

      {/* Suppress Settings */}
      <Section title="Suppress" description="Control which types of pings can notify you.">
        <Toggle
          label="Suppress @everyone and @here"
          checked={suppressEveryone}
          onChange={(v) => updateSettings({ suppressEveryone: v })}
        />
        <Toggle
          label="Suppress all role @mentions"
          checked={suppressRoleMentions}
          onChange={(v) => updateSettings({ suppressRoleMentions: v })}
        />
      </Section>

      {/* Channel Overrides */}
      {channels.length > 0 && (
        <Section title="Channel Overrides" description="Override notification settings for individual channels.">
          <div className="space-y-1">
            {[...channels].sort((a, b) => a.position - b.position).map((ch) => (
              <ChannelOverrideRow
                key={ch.id}
                channelId={`${spaceId}:${ch.id}`}
                label={ch.label}
              />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function ChannelOverrideRow({ channelId, label }: { channelId: string; label: string }) {
  const dispatch = useAppDispatch();
  const currentMode = useChannelMode(channelId);

  return (
    <div className="flex items-center justify-between rounded-xl px-3 py-2 hover:bg-surface-hover transition-colors">
      <span className="text-sm text-body">{label}</span>
      <select
        value={currentMode}
        onChange={(e) => dispatch(setChannelNotifMode({ channelId, mode: e.target.value as ChannelNotifMode }))}
        className="rounded-lg bg-field border border-border px-2 py-1 text-xs text-heading focus:border-primary focus:outline-none"
      >
        {CHANNEL_MODES.map((m) => (
          <option key={m.value} value={m.value}>{m.label}</option>
        ))}
      </select>
    </div>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div>
        <h4 className="text-xs font-semibold text-heading">{title}</h4>
        <p className="text-[10px] text-muted">{description}</p>
      </div>
      {children}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between rounded-xl px-3 py-2 hover:bg-surface-hover transition-colors cursor-pointer">
      <span className="text-sm text-body">{label}</span>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 rounded-full transition-colors ${checked ? "bg-primary" : "bg-surface-hover"}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform ${checked ? "translate-x-4" : ""}`}
        />
      </button>
    </label>
  );
}
