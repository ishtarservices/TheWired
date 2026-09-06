/**
 * Media device enumeration and getUserMedia/getDisplayMedia wrappers.
 *
 * Platform notes:
 * - macOS Tauri: Requires Info.plist with NSCameraUsageDescription, NSMicrophoneUsageDescription
 * - macOS Tauri (hardened runtime): Requires Entitlements.plist with com.apple.security.device.camera, .audio-input
 * - Web browsers: Requires secure context (HTTPS or localhost)
 * - Safari: Stricter about secure context — may block on http://localhost in some versions
 */
import { isWindows, isMacOS } from "../platform";

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

type MediaErrorKind = "microphone" | "camera" | "screen" | "media";

/**
 * Human-readable, platform-aware description of a getUserMedia /
 * getDisplayMedia failure. The DOMException names are the contract:
 *
 *  - NotAllowedError   → permission denied (OS prompt or settings)
 *  - NotReadableError  → hardware busy — on Windows this is the common case
 *                        when Zoom/Teams/OBS holds the camera or mic
 *  - NotFoundError     → no device of that kind
 *  - OverconstrainedError → the remembered deviceId is gone (unplugged)
 */
export function describeMediaError(err: unknown, kind: MediaErrorKind = "media"): string {
  const name = (err as { name?: string } | null)?.name ?? "";
  const message = (err as { message?: string } | null)?.message ?? "";
  const what = kind === "media" ? "camera or microphone" : kind;

  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return `Permission denied for the ${what}. ${permissionHint()}`;
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return `The ${what} is in use by another app or unavailable. Close other apps using it and try again.`;
    case "NotFoundError":
    case "DevicesNotFoundError":
      return `No ${what} found. Connect one and try again.`;
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return `The selected ${what} is no longer available. Pick another device.`;
    default:
      return message ? `Could not access the ${what}: ${message}` : `Could not access the ${what}.`;
  }
}

function permissionHint(): string {
  if (isWindows) return "Allow it in Windows Settings › Privacy & security › Microphone / Camera, then retry.";
  if (isMacOS) return "Allow it in System Settings › Privacy & Security, then retry.";
  return "Check your browser or system permissions, then retry.";
}

/**
 * Enumerate available media devices (cameras, microphones, speakers).
 *
 * Labels are only exposed after a permission grant. If labels are already
 * available (permission granted earlier this session or persisted by the
 * WebView) no capture is started. Otherwise audio and video are requested
 * SEPARATELY so a busy camera (Windows NotReadableError) cannot block
 * microphone labels.
 */
export async function enumerateDevices(): Promise<MediaDeviceInfo[]> {
  if (!isMediaDevicesAvailable()) return [];

  let devices = await navigator.mediaDevices.enumerateDevices();
  const hasLabels = (kind: MediaDeviceKind) =>
    devices.some((d) => d.kind === kind && d.label);

  const probes: MediaStreamConstraints[] = [];
  if (!hasLabels("audioinput")) probes.push({ audio: true });
  if (!hasLabels("videoinput") && devices.some((d) => d.kind === "videoinput")) {
    probes.push({ video: true });
  }
  for (const constraints of probes) {
    try {
      const tmp = await navigator.mediaDevices.getUserMedia(constraints);
      tmp.getTracks().forEach((t) => t.stop());
    } catch {
      // Denied or busy — labels for this kind stay generic.
    }
  }
  if (probes.length > 0) {
    devices = await navigator.mediaDevices.enumerateDevices();
  }

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
  } catch (err: unknown) {
    const kind: MediaErrorKind =
      constraints.video && constraints.audio ? "media" : constraints.video ? "camera" : "microphone";
    const wrapped = new Error(describeMediaError(err, kind));
    // Preserve the DOMException name so callers can still branch on it
    // (e.g. NotAllowedError = user cancelled a picker).
    wrapped.name = (err as { name?: string } | null)?.name ?? "Error";
    throw wrapped;
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
