import { useState } from "react";
import { Mic } from "lucide-react";
import { DevicePicker } from "../voice/devices/DevicePicker";
import { InputLevelMeter } from "../voice/devices/InputLevelMeter";
import { useMediaPrefs } from "../voice/devices/useMediaPrefs";
import { Toggle } from "@/components/ui/Toggle";

/**
 * Voice & Video settings: device selection, capture processing, mic test.
 * Choices persist per machine (localStorage) and apply immediately to a
 * live room via livekitClient's pref subscription.
 */
export function VoiceSettingsTab() {
  const [testing, setTesting] = useState(false);
  const [prefs, update] = useMediaPrefs();

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-heading">Devices</h3>
          <p className="text-xs text-muted">
            Used for voice channels and calls. Changes apply right away, even mid-call.
          </p>
        </div>
        <div className="px-4 py-4">
          <DevicePicker showProcessing />
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-heading">Screen sharing</h3>
          <p className="text-xs text-muted">Applies to the next share you start.</p>
        </div>
        <Toggle
          label="Optimize for video and motion"
          description="1080p at 30 fps (about 5 Mbps) for playing video or games. Off = 15 fps tuned for crisp text and slides (about 2.5 Mbps)."
          checked={prefs.screenShareMotion}
          onChange={(v) => update({ screenShareMotion: v })}
        />
      </section>

      <section className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-heading">Microphone test</h3>
          <p className="text-xs text-muted">
            Speak normally — the meter should reach the green/amber range. Nothing is sent anywhere.
          </p>
        </div>
        <div className="flex items-center gap-4 px-4 py-4">
          <button
            onClick={() => setTesting((v) => !v)}
            className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              testing
                ? "bg-red-500/15 text-red-400 hover:bg-red-500/25"
                : "bg-primary/15 text-primary hover:bg-primary/25"
            }`}
          >
            <Mic size={14} />
            {testing ? "Stop test" : "Test microphone"}
          </button>
          <div className="min-w-0 flex-1">
            <InputLevelMeter active={testing} />
          </div>
        </div>
      </section>
    </div>
  );
}
