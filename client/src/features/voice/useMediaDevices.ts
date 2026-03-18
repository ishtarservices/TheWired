import { useState, useEffect, useCallback } from "react";
import {
  enumerateDevices,
  onDeviceChange,
  type MediaDeviceInfo,
} from "@/lib/webrtc/mediaDevices";

/**
 * Hook to enumerate and select media devices (cameras, microphones, speakers).
 */
export function useMediaDevices() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioInput, setSelectedAudioInput] = useState<string>("");
  const [selectedAudioOutput, setSelectedAudioOutput] = useState<string>("");
  const [selectedVideoInput, setSelectedVideoInput] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const devs = await enumerateDevices();
      setDevices(devs);

      // Auto-select first device of each type if not already selected
      const audioInputs = devs.filter((d) => d.kind === "audioinput");
      const audioOutputs = devs.filter((d) => d.kind === "audiooutput");
      const videoInputs = devs.filter((d) => d.kind === "videoinput");

      setSelectedAudioInput((prev) =>
        prev && audioInputs.some((d) => d.deviceId === prev) ? prev : audioInputs[0]?.deviceId ?? "",
      );
      setSelectedAudioOutput((prev) =>
        prev && audioOutputs.some((d) => d.deviceId === prev) ? prev : audioOutputs[0]?.deviceId ?? "",
      );
      setSelectedVideoInput((prev) =>
        prev && videoInputs.some((d) => d.deviceId === prev) ? prev : videoInputs[0]?.deviceId ?? "",
      );
    } catch (err) {
      console.warn("[mediaDevices] Failed to enumerate:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const cleanup = onDeviceChange(refresh);
    return cleanup;
  }, [refresh]);

  const audioInputs = devices.filter((d) => d.kind === "audioinput");
  const audioOutputs = devices.filter((d) => d.kind === "audiooutput");
  const videoInputs = devices.filter((d) => d.kind === "videoinput");

  return {
    devices,
    audioInputs,
    audioOutputs,
    videoInputs,
    selectedAudioInput,
    selectedAudioOutput,
    selectedVideoInput,
    setSelectedAudioInput,
    setSelectedAudioOutput,
    setSelectedVideoInput,
    loading,
    refresh,
  };
}
