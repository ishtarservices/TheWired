// ─── Haptic layering ─────────────────────────────────────────────────
// One module so the intensity policy lives in one place (W1 §5):
//   selection  — tab switches, toggles, segmented controls, minor buttons
//   tap        — light impact on primary actions (post, confirm, open)
//   success    — publish / login / copy-completed moments
//   warning/error — destructive confirms, failures
// Never on scroll. All calls are fire-and-forget and safe on devices
// without a haptic engine (errors swallowed).

import * as Haptics from "expo-haptics";

export const haptics = {
  selection(): void {
    Haptics.selectionAsync().catch(() => {});
  },
  tap(): void {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  },
  success(): void {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  },
  warning(): void {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  },
  error(): void {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
  },
};

export type HapticKind = keyof typeof haptics;

/** Hook form for components; returns the shared policy object. */
export function useHaptics(): typeof haptics {
  return haptics;
}
