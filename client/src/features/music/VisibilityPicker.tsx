import { Globe, Lock, Users, HardDrive } from "lucide-react";
import type { MusicVisibility } from "@/types/music";
import { useAppSelector } from "@/store/hooks";

interface VisibilityPickerProps {
  value: MusicVisibility;
  onChange: (v: MusicVisibility) => void;
  spaceId: string;
  onSpaceIdChange: (id: string) => void;
  channelId?: string;
  onChannelIdChange?: (id: string) => void;
}

const OPTIONS: { value: MusicVisibility; label: string; desc: string; icon: typeof Globe }[] = [
  { value: "public", label: "Public", desc: "Discoverable by everyone", icon: Globe },
  { value: "private", label: "Private", desc: "Only you and collaborators", icon: Lock },
  { value: "space", label: "Space", desc: "Visible to space members only", icon: Users },
  { value: "local", label: "Local", desc: "Stored on this device only", icon: HardDrive },
];

export function VisibilityPicker({ value, onChange, spaceId, onSpaceIdChange, channelId, onChannelIdChange }: VisibilityPickerProps) {
  const spaces = useAppSelector((s) => s.spaces.list);
  const allChannels = useAppSelector((s) => s.spaces.channels);

  // Get music channels for the selected space
  const musicChannels = spaceId
    ? (allChannels[spaceId] ?? []).filter((c) => c.type === "music")
    : [];

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-soft">Visibility</label>
      <div className="space-y-1">
        {OPTIONS.map((opt) => {
          const Icon = opt.icon;
          return (
            <label
              key={opt.value}
              className={`flex cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
                value === opt.value ? "bg-primary/8 text-heading" : "text-soft hover:bg-surface"
              }`}
            >
              <input
                type="radio"
                name="visibility"
                value={opt.value}
                checked={value === opt.value}
                onChange={() => onChange(opt.value)}
                className="sr-only"
              />
              <Icon size={14} />
              <span className="font-medium">{opt.label}</span>
              <span className="ml-auto text-xs text-muted">{opt.desc}</span>
            </label>
          );
        })}
      </div>
      {value === "space" && (
        <>
          <select
            value={spaceId}
            onChange={(e) => {
              onSpaceIdChange(e.target.value);
              onChannelIdChange?.("");
            }}
            className="mt-2 w-full rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-heading outline-none focus:border-primary/30"
          >
            <option value="">Select a space</option>
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {onChannelIdChange && musicChannels.length > 1 && (
            <select
              value={channelId ?? ""}
              onChange={(e) => onChannelIdChange(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-heading outline-none focus:border-primary/30"
            >
              <option value="">Default music channel</option>
              {musicChannels.map((ch) => (
                <option key={ch.id} value={ch.id}>
                  {ch.label} {ch.feedMode === "curated" ? "(Curated)" : ""}
                </option>
              ))}
            </select>
          )}
        </>
      )}
    </div>
  );
}
