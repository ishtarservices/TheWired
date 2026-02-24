import { Globe, Link2, Users, HardDrive } from "lucide-react";
import type { MusicVisibility } from "@/types/music";
import { useAppSelector } from "@/store/hooks";

interface VisibilityPickerProps {
  value: MusicVisibility;
  onChange: (v: MusicVisibility) => void;
  spaceId: string;
  onSpaceIdChange: (id: string) => void;
}

const OPTIONS: { value: MusicVisibility; label: string; desc: string; icon: typeof Globe }[] = [
  { value: "public", label: "Public", desc: "Discoverable by everyone", icon: Globe },
  { value: "unlisted", label: "Unlisted", desc: "Accessible via link, not in feeds", icon: Link2 },
  { value: "space", label: "Space", desc: "Visible to space members only", icon: Users },
  { value: "local", label: "Local", desc: "Stored on this device only", icon: HardDrive },
];

export function VisibilityPicker({ value, onChange, spaceId, onSpaceIdChange }: VisibilityPickerProps) {
  const spaces = useAppSelector((s) => s.spaces.list);

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
                value === opt.value ? "bg-card text-heading" : "text-soft hover:bg-card-hover/30"
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
        <select
          value={spaceId}
          onChange={(e) => onSpaceIdChange(e.target.value)}
          className="mt-2 w-full rounded-md border border-edge bg-field px-3 py-1.5 text-sm text-heading outline-none focus:border-heading/50"
        >
          <option value="">Select a space</option>
          {spaces.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
