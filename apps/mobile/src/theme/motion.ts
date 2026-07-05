// ─── Motion system ───────────────────────────────────────────────────
// One vocabulary for animation across the app, gated by two dials:
// the preset's motionIntensity (0–1, presets.ts) and the OS reduce-motion
// setting. Reduce motion always wins — effective intensity drops to 0 and
// entrance animations are skipped entirely (Reanimated's ReduceMotion.System
// covers the spring/timing paths as a second belt).

import { FadeIn, FadeInDown, ReduceMotion, useReducedMotion } from "react-native-reanimated";
import type { WithSpringConfig, WithTimingConfig } from "react-native-reanimated";

import { DURATION } from "./constants";
import { useTheme } from "./ThemeContext";

/** Spring vocabulary — snappy for presses, gentle for layout/sheet moves. */
export const SPRING: Record<"snappy" | "gentle", WithSpringConfig> = {
  snappy: { damping: 18, stiffness: 260, mass: 0.7, reduceMotion: ReduceMotion.System },
  gentle: { damping: 22, stiffness: 140, mass: 1, reduceMotion: ReduceMotion.System },
};

export const TIMING: Record<"fast" | "smooth", WithTimingConfig> = {
  fast: { duration: DURATION.fast, reduceMotion: ReduceMotion.System },
  smooth: { duration: DURATION.smooth, reduceMotion: ReduceMotion.System },
};

/** Press-scale target: 0.97 at full intensity, easing toward 1 as the
 *  preset calms down; exactly 1 (no scale) at intensity 0. */
export function pressedScale(intensity: number): number {
  const t = Math.max(0, Math.min(1, intensity));
  return 1 - 0.03 * t;
}

/** Staggered list-mount delay: 40ms per item, capped at 8 items so long
 *  lists don't wait forever (items past the cap animate together). */
export function entranceDelay(index: number, stepMs = 40, cap = 8): number {
  return Math.min(Math.max(0, index), cap - 1) * stepMs;
}

/** Entering animation for list items / screen content. Returns undefined
 *  when motion is off — spread as `entering={...}` (undefined = no-op). */
export function listEntering(index: number, intensity: number, reducedMotion: boolean) {
  if (reducedMotion || intensity <= 0) return undefined;
  return FadeInDown.duration(DURATION.smooth)
    .delay(entranceDelay(index))
    .reduceMotion(ReduceMotion.System);
}

/** Plain fade-in for single surfaces (headers, empty states). */
export function fadeEntering(intensity: number, reducedMotion: boolean, delayMs = 0) {
  if (reducedMotion || intensity <= 0) return undefined;
  return FadeIn.duration(DURATION.smooth).delay(delayMs).reduceMotion(ReduceMotion.System);
}

export interface Motion {
  /** Effective intensity — the preset dial with reduce-motion forcing 0. */
  intensity: number;
  reducedMotion: boolean;
  /** Press-scale target for the active intensity. */
  pressScale: number;
  /** entering= for the Nth mounted list item (undefined when motion is off). */
  entering: (index: number) => ReturnType<typeof listEntering>;
  /** entering= fade for single surfaces. */
  fade: (delayMs?: number) => ReturnType<typeof fadeEntering>;
}

/** The one hook components use — policy lives here, not at call sites. */
export function useMotion(): Motion {
  const { motionIntensity } = useTheme();
  const reducedMotion = useReducedMotion();
  const intensity = reducedMotion ? 0 : motionIntensity;

  return {
    intensity,
    reducedMotion,
    pressScale: pressedScale(intensity),
    entering: (index: number) => listEntering(index, intensity, reducedMotion),
    fade: (delayMs = 0) => fadeEntering(intensity, reducedMotion, delayMs),
  };
}
