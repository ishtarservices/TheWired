import { useCallback, useEffect, useState } from "react";
import {
  enumerateDevices,
  onDeviceChange,
  type MediaDeviceInfo,
} from "@/lib/webrtc/mediaDevices";
import { useMediaPrefs } from "./useMediaPrefs";

/**
 * Device lists + the persisted selection for each kind.
 *
 * Selection lives in `mediaPrefs` (localStorage), so a choice made in
 * Settings applies to the next join and to the live room (livekitClient
 * subscribes to pref changes). A remembered device that is no longer present
 * (headset unplugged) falls back to "System default" in the UI without
 * clearing the preference — plugging it back in restores it.
 */
export function useMediaDevices() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [prefs, update] = useMediaPrefs();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setDevices(await enumerateDevices());
    } catch (err) {
      console.warn("[mediaDevices] Failed to enumerate:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return onDeviceChange(() => void refresh());
  }, [refresh]);

  const audioInputs = devices.filter((d) => d.kind === "audioinput");
  const audioOutputs = devices.filter((d) => d.kind === "audiooutput");
  const videoInputs = devices.filter((d) => d.kind === "videoinput");

  const present = (list: MediaDeviceInfo[], id: string | null) =>
    id && list.some((d) => d.deviceId === id) ? id : "";

  return {
    devices,
    audioInputs,
    audioOutputs,
    videoInputs,
    loading,
    refresh,
    /** "" means system default (or the remembered device is absent). */
    selectedAudioInput: present(audioInputs, prefs.audioInput),
    selectedAudioOutput: present(audioOutputs, prefs.audioOutput),
    selectedVideoInput: present(videoInputs, prefs.videoInput),
    setSelectedAudioInput: (id: string) => update({ audioInput: id || null }),
    setSelectedAudioOutput: (id: string) => update({ audioOutput: id || null }),
    setSelectedVideoInput: (id: string) => update({ videoInput: id || null }),
  };
}
