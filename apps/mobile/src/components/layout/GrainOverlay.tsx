// ─── Film-grain canvas overlay ───────────────────────────────────────
// A static noise tile (assets/grain.png, regenerate via pnpm generate:grain)
// repeated across the whole shell at very low opacity — the texture that
// keeps the signal preset's near-black canvas from reading as dead flat.
// Mounted ONCE in App.tsx's ThemedShell, above navigation, below the status
// bar; RN Modals escape it (accepted). Static by design — no animation, no
// battery cost. Gated by the preset's `grain` flag via ThemeContext.
//
// Image + plain style only (no className) — css-interop XOR rule
// (src/lib/animated.ts). RN 0.86 new-arch also supports
// `mixBlendMode: "overlay"` here if a stronger weave is wanted after
// visual QA; plain low opacity is the safe default.

import { Image, StyleSheet, View } from "react-native";

import { useTheme } from "@/theme/ThemeContext";

const GRAIN_OPACITY = 0.04;

export function GrainOverlay() {
  const { grain } = useTheme();
  if (!grain) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Image
        source={require("../../../assets/grain.png")}
        resizeMode="repeat"
        fadeDuration={0}
        style={{ width: "100%", height: "100%", opacity: GRAIN_OPACITY }}
      />
    </View>
  );
}
