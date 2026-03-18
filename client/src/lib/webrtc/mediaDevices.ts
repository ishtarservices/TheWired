/**
 * Media device enumeration and getUserMedia/getDisplayMedia wrappers.
 *
 * Platform notes:
 * - macOS Tauri: Requires Info.plist with NSCameraUsageDescription, NSMicrophoneUsageDescription
 * - macOS Tauri (hardened runtime): Requires Entitlements.plist with com.apple.security.device.camera, .audio-input
 * - Web browsers: Requires secure context (HTTPS or localhost)
 * - Safari: Stricter about secure context — may block on http://localhost in some versions
 */

export interface MediaDeviceInfo {
  deviceId: string;
  label: string;
  kind: "audioinput" | "audiooutput" | "videoinput";
}

/**
 * Check if media devices API is available.
 * Returns false on insecure contexts or unsupported browsers.
 */
export function isMediaDevicesAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices !== "undefined" &&
    typeof navigator.mediaDevices.getUserMedia === "function"
  );
}

/**
 * Check if screen sharing API is available.
 */
export function supportsScreenShare(): boolean {
  return (
    isMediaDevicesAvailable() &&
    typeof navigator.mediaDevices.getDisplayMedia === "function"
  );
}

/**
 * Enumerate available media devices (cameras, microphones, speakers).
 * Requests a temporary stream first to get device labels (required by browsers).
 */
export async function enumerateDevices(): Promise<MediaDeviceInfo[]> {
  if (!isMediaDevicesAvailable()) return [];

  // Request temporary access to get device labels
  try {
    const tempStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: true,
    });
    // Stop tracks immediately — we just needed permission for labels
    tempStream.getTracks().forEach((t) => t.stop());
  } catch {
    // Ignore — user may have denied permission, or devices unavailable
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === "audioinput" || d.kind === "audiooutput" || d.kind === "videoinput")
    .map((d) => ({
      deviceId: d.deviceId,
      label: d.label || `${d.kind} (${d.deviceId.slice(0, 8)})`,
      kind: d.kind as MediaDeviceInfo["kind"],
    }));
}

/**
 * Get user media (camera and/or microphone).
 * Throws a descriptive error if media devices are unavailable.
 */
export async function getUserMedia(options: {
  audio?: boolean | MediaTrackConstraints;
  video?: boolean | MediaTrackConstraints;
  audioDeviceId?: string;
  videoDeviceId?: string;
}): Promise<MediaStream> {
  if (!isMediaDevicesAvailable()) {
    throw new Error(
      "Media devices not available. " +
      (window.isSecureContext
        ? "Camera/microphone permissions may be blocked. Check your browser or OS settings."
        : "A secure context (HTTPS) is required for media access."),
    );
  }

  const constraints: MediaStreamConstraints = {
    audio: options.audio === false
      ? false
      : options.audioDeviceId
        ? { ...asObject(options.audio), deviceId: { exact: options.audioDeviceId } }
        : options.audio ?? true,
    video: options.video === false
      ? false
      : options.videoDeviceId
        ? { ...asObject(options.video), deviceId: { exact: options.videoDeviceId } }
        : options.video ?? false,
  };

  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err: any) {
    if (err.name === "NotAllowedError") {
      throw new Error(
        "Permission denied. Please allow camera/microphone access in your browser or system settings.",
      );
    }
    if (err.name === "NotFoundError" || err.name === "NotReadableError") {
      throw new Error(
        "No camera or microphone found. Please connect a device and try again.",
      );
    }
    throw err;
  }
}

/**
 * Get display media (screen sharing).
 */
export async function getDisplayMedia(options?: {
  video?: boolean | MediaTrackConstraints;
  audio?: boolean;
}): Promise<MediaStream> {
  if (!supportsScreenShare()) {
    throw new Error("Screen sharing is not supported in this environment.");
  }

  return navigator.mediaDevices.getDisplayMedia({
    video: options?.video ?? { displaySurface: "monitor" },
    audio: options?.audio ?? false,
  });
}

/**
 * Stop all tracks in a media stream.
 */
export function stopMediaStream(stream: MediaStream): void {
  stream.getTracks().forEach((track) => track.stop());
}

/**
 * Listen for device changes (e.g., headphones plugged in).
 */
export function onDeviceChange(callback: () => void): () => void {
  if (!isMediaDevicesAvailable()) return () => {};
  navigator.mediaDevices.addEventListener("devicechange", callback);
  return () => navigator.mediaDevices.removeEventListener("devicechange", callback);
}

/** Helper to normalize boolean | object constraints */
function asObject(value: boolean | MediaTrackConstraints | undefined): MediaTrackConstraints {
  if (typeof value === "object") return value;
  return {};
}
