import { Camera, Mic, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { supportsAudioOutputSelection, isMacOS } from "@/lib/platform";
import type { MediaDeviceInfo } from "@/lib/webrtc/mediaDevices";
import { useMediaDevices } from "./useMediaDevices";
import { useMediaPrefs } from "./useMediaPrefs";
import { Toggle } from "@/components/ui/Toggle";

interface DevicePickerProps {
  /** Tighter layout for the in-call popover. */
  compact?: boolean;
  /** Include the echo/noise/gain toggles (settings page). */
  showProcessing?: boolean;
  /** Include the "Let voices overlap" switch (in-call popover). */
  showOverlap?: boolean;
  /** Hide the camera select (audio-only contexts). */
  hideCamera?: boolean;
}

/**
 * Microphone / camera / speaker selection. Speaker selection needs
 * `HTMLMediaElement.setSinkId`, which WKWebView (macOS) does not implement —
 * the select is replaced by a hint there.
 */
export function DevicePicker({ compact, showProcessing, showOverlap, hideCamera }: DevicePickerProps) {
  const d = useMediaDevices({ video: !hideCamera });
  const [prefs, update] = useMediaPrefs();

  return (
    <div className={cn("flex flex-col", compact ? "gap-2" : "gap-4")}>
      <DeviceSelect
        icon={<Mic size={14} />}
        label="Microphone"
        devices={d.audioInputs}
        value={d.selectedAudioInput}
        onChange={d.setSelectedAudioInput}
        compact={compact}
        loading={d.loading}
      />

      {supportsAudioOutputSelection ? (
        <DeviceSelect
          icon={<Volume2 size={14} />}
          label="Speaker"
          devices={d.audioOutputs}
          value={d.selectedAudioOutput}
          onChange={d.setSelectedAudioOutput}
          compact={compact}
          loading={d.loading}
        />
      ) : (
        <div className={cn("text-muted", compact ? "text-[11px]" : "text-xs")}>
          <span className="inline-flex items-center gap-1 font-medium text-soft">
            <Volume2 size={12} /> Speaker
          </span>
          <span className="ml-1">
            {isMacOS
              ? "follows the macOS output device (System Settings › Sound)."
              : "follows the system output device."}
          </span>
        </div>
      )}

      {!hideCamera && (
        <DeviceSelect
          icon={<Camera size={14} />}
          label="Camera"
          devices={d.videoInputs}
          value={d.selectedVideoInput}
          onChange={d.setSelectedVideoInput}
          compact={compact}
          loading={d.loading}
        />
      )}

      {showOverlap && (
        // The in-call face of the echo cancellation setting, named for what
        // people notice: with it on, a voice dips while someone else talks.
        <div className="-mx-3 border-t border-border">
          <Toggle
            label="Let voices overlap"
            description="Your voice is no longer lowered while someone else is talking. Use headphones: this turns echo cancellation off, so speakers would echo the room."
            checked={!prefs.echoCancellation}
            onChange={(v) => update({ echoCancellation: !v })}
          />
        </div>
      )}

      {showProcessing && (
        <div className="-mx-4 divide-y divide-border border-t border-border">
          <Toggle
            label="Echo cancellation"
            description="Stops the other side hearing themselves through your speakers. It also lowers your voice while someone else is talking, so turn it off with a headset if people can't talk over each other."
            checked={prefs.echoCancellation}
            onChange={(v) => update({ echoCancellation: v })}
          />
          <Toggle
            label="Noise suppression"
            description="Filters fans, keyboards and background hum, and isolates your voice where the system supports it. Turn off if soft speech is being cut."
            checked={prefs.noiseSuppression}
            onChange={(v) => update({ noiseSuppression: v })}
          />
          <Toggle
            label="Automatic gain control"
            description="Evens out your volume. Turn off if your voice pumps louder and quieter."
            checked={prefs.autoGainControl}
            onChange={(v) => update({ autoGainControl: v })}
          />
        </div>
      )}
    </div>
  );
}

function DeviceSelect({
  icon,
  label,
  devices,
  value,
  onChange,
  compact,
  loading,
}: {
  icon: React.ReactNode;
  label: string;
  devices: MediaDeviceInfo[];
  value: string;
  onChange: (id: string) => void;
  compact?: boolean;
  loading: boolean;
}) {
  const id = `device-${label.toLowerCase()}`;
  return (
    <label htmlFor={id} className="flex flex-col gap-1">
      <span
        className={cn(
          "inline-flex items-center gap-1.5 font-medium text-soft",
          compact ? "text-[11px]" : "text-xs",
        )}
      >
        {icon}
        {label}
      </span>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={loading && devices.length === 0}
        className={cn(
          "w-full rounded-lg border border-border bg-surface text-heading outline-none focus:border-primary disabled:opacity-60",
          compact ? "px-2 py-1 text-xs" : "px-3 py-2 text-sm",
        )}
      >
        <option value="">System default</option>
        {devices.map((dev) => (
          <option key={dev.deviceId} value={dev.deviceId}>
            {dev.label}
          </option>
        ))}
      </select>
    </label>
  );
}
