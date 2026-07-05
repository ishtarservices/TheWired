import { useNavigation } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import { Platform, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { continueAsGuest } from "@/auth/session";
import { Button } from "@/components/ui/Button";
import { Type } from "@/components/ui/Type";
import { AnimatedView } from "@/lib/animated";
import { haptics } from "@/lib/haptics";
import { useAppDispatch } from "@/store/hooks";
import { toCSS, withAlpha } from "@/theme/engine";
import { useMotion } from "@/theme/motion";
import { useTheme } from "@/theme/ThemeContext";

// The first screen anyone sees — a moment, not a form (W1 §7): wordmark in
// the preset display face over an ambient primary glow, actions staggered in
// and biased to the bottom third (thumb zone).

/** Smooth ambient wash: primary → transparent gradient (no alpha-disc
 *  banding) + one soft glow center via an iOS shadow. */
function AmbientGlow() {
  const { config } = useTheme();
  const { width, height } = useWindowDimensions();
  const primary = config.colors.primary;

  return (
    <View pointerEvents="none" className="absolute inset-0">
      <LinearGradient
        colors={[withAlpha(primary, 0.22), withAlpha(primary, 0.07), "transparent"]}
        locations={[0, 0.45, 1]}
        style={{ position: "absolute", top: 0, left: 0, right: 0, height: height * 0.5 }}
      />
      {Platform.OS === "ios" ? (
        // Glow with no visible disc: transparent core, all light from the
        // shadow (shadow renders even when the fill is invisible-ish).
        <View
          style={{
            position: "absolute",
            top: -width * 0.7,
            alignSelf: "center",
            width: width * 0.9,
            height: width * 0.9,
            borderRadius: (width * 0.9) / 2,
            backgroundColor: withAlpha(primary, 0.05),
            shadowColor: toCSS(primary),
            shadowOpacity: 0.45,
            shadowRadius: 110,
            shadowOffset: { width: 0, height: 40 },
          }}
        />
      ) : null}
    </View>
  );
}

export function WelcomeScreen() {
  const navigation = useNavigation();
  const dispatch = useAppDispatch();
  const insets = useSafeAreaInsets();
  const { entering } = useMotion();

  return (
    <View
      className="flex-1 bg-background px-6"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom + 16 }}
    >
      <AmbientGlow />

      {/* Branding */}
      <View className="flex-1 items-center justify-center">
        <AnimatedView entering={entering(0)} className="items-center">
          <Type role="display" className="tracking-[6px] text-heading">
            THE WIRED
          </Type>
          <Type role="body" className="mt-4 max-w-[300px] text-center text-soft">
            spaces, music and messages on nostr
          </Type>
          <Type role="caption" className="mt-1.5 text-center text-muted">
            your identity is a key — no email, no password, no account server
          </Type>
        </AnimatedView>
      </View>

      {/* Actions — bottom third, thumb zone */}
      <View className="gap-3">
        <AnimatedView entering={entering(1)}>
          <Button size="lg" onPress={() => navigation.navigate("CreateIdentity")}>
            Create a new identity
          </Button>
        </AnimatedView>
        <AnimatedView entering={entering(2)}>
          <Button
            size="lg"
            variant="secondary"
            onPress={() => navigation.navigate("Login")}
          >
            I already have a key
          </Button>
        </AnimatedView>
        <AnimatedView entering={entering(3)}>
          <Button
            size="lg"
            variant="ghost"
            onPress={() => {
              haptics.selection();
              dispatch(continueAsGuest());
            }}
          >
            Browse without an account
          </Button>
        </AnimatedView>
        <AnimatedView entering={entering(4)}>
          <Type role="micro" className="mt-1 px-4 text-center leading-4 text-faint">
            Your secret key stays in this device's keychain. Browsing without an
            account is read-only — sign in any time.
          </Type>
        </AnimatedView>
      </View>
    </View>
  );
}
