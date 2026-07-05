import "./global.css";

import { useEffect, useMemo, useState } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Provider as StoreProvider } from "react-redux";
import { useFonts } from "expo-font";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import {
  SpaceGrotesk_400Regular,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from "@expo-google-fonts/space-grotesk";

import { hydrateSession } from "@/auth/session";
import { Type } from "@/components/ui/Type";
import { linking } from "@/navigation/linking";
import { RootNavigator } from "@/navigation/RootNavigator";
import { createMobileAdapters } from "@/platform/adapters";
import { getStoredThemePreset } from "@/platform/appPrefs";
import { MobileLifecycleController } from "@/platform/lifecycle/MobileLifecycleController";
import { createStore, type AppStore } from "@/store";
import { useAppSelector } from "@/store/hooks";
import {
  appBackgrounded,
  appForegrounded,
  setOnline,
} from "@/store/slices/lifecycleSlice";
import { ThemeProvider, useTheme } from "@/theme/ThemeContext";
import { navigationFonts, toNavigationTheme } from "@/theme/navigationTheme";
import { DEFAULT_PRESET } from "@/theme/presets";
import { setFontsReady } from "@/theme/typography";

export default function App() {
  // Adapters are built once and threaded into the store factory — the same
  // wiring @thewired/core will consume at Phase 0.
  const [store] = useState<AppStore>(() => createStore(createMobileAdapters()));

  // Preset fonts (typography.ts resolves per-preset family → these assets).
  // fontError still renders — typography falls back to the system font.
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    SpaceGrotesk_400Regular,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
  });
  const fontsReady = fontsLoaded || !!fontError;
  setFontsReady(fontsLoaded);

  // Persisted theme preset, read before first themed paint so returning
  // light-theme users don't get a dark flash (and vice versa).
  const [initialPreset, setInitialPreset] = useState<string | null>(null);
  useEffect(() => {
    getStoredThemePreset().then((stored) => setInitialPreset(stored ?? DEFAULT_PRESET));
  }, []);

  useMobileLifecycle(store);

  // Cold-start session hydration: keychain → signer → loggedIn/loggedOut.
  // RootNavigator shows a splash while identity.status === "hydrating".
  useEffect(() => {
    store.dispatch(hydrateSession());
  }, [store]);

  if (!fontsReady || initialPreset === null) {
    // Bare frame matching app.json backgroundColor — fonts + preset resolve
    // in well under a second; rendering text now would flash system fonts.
    return <View style={{ flex: 1, backgroundColor: "#121317" }} />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StoreProvider store={store}>
          <ThemeProvider initialPreset={initialPreset}>
            <ThemedShell />
          </ThemeProvider>
        </StoreProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/** Inside ThemeProvider — spreads the NativeWind vars() on the root View so
 *  every className below resolves the active preset's tokens. */
function ThemedShell() {
  const { themeVars, tokens, isDark, config } = useTheme();
  const sessionStatus = useAppSelector((s) => s.identity.status);
  const navTheme = useMemo(() => toNavigationTheme(tokens, isDark), [tokens, isDark]);
  const navFonts = useMemo(() => navigationFonts(config.font?.family), [config]);

  return (
    <View style={[{ flex: 1 }, themeVars]}>
      {sessionStatus === "hydrating" ? (
        // Keychain read in flight — hold a blank themed frame instead of
        // flashing the Welcome screen at already-logged-in users.
        <View className="flex-1 bg-background" />
      ) : (
        <>
          <NavigationContainer theme={{ ...navTheme, fonts: navFonts }} linking={linking}>
            <RootNavigator />
          </NavigationContainer>
          <OfflineBanner />
        </>
      )}
      <StatusBar style={isDark ? "light" : "dark"} />
    </View>
  );
}

function OfflineBanner() {
  const isOnline = useAppSelector((s) => s.lifecycle.isOnline);
  if (isOnline) return null;
  return (
    <View className="absolute left-0 right-0 top-14 items-center" pointerEvents="none">
      <View className="rounded-full bg-warning px-4 py-1.5">
        <Type role="micro" weight={600} className="text-background">
          offline — reconnecting when the network returns
        </Type>
      </View>
    </View>
  );
}

/** AppState + NetInfo → Redux. The relay pool teardown/rebuild hooks onto the
 *  same controller once the core lands (guide 06 §2). */
function useMobileLifecycle(store: AppStore) {
  useEffect(() => {
    const controller = new MobileLifecycleController({
      onForeground: () => store.dispatch(appForegrounded({ at: Date.now() })),
      onBackground: () => store.dispatch(appBackgrounded()),
      onOnline: () => store.dispatch(setOnline(true)),
      onOffline: () => store.dispatch(setOnline(false)),
    });
    controller.start();
    return () => controller.stop();
  }, [store]);
}
