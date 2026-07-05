import "./global.css";

import { useEffect, useMemo, useState } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import { Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Provider as StoreProvider } from "react-redux";

import { hydrateSession } from "@/auth/session";
import { Spinner } from "@/components/ui/Spinner";
import { linking } from "@/navigation/linking";
import { RootNavigator } from "@/navigation/RootNavigator";
import { createMobileAdapters } from "@/platform/adapters";
import { MobileLifecycleController } from "@/platform/lifecycle/MobileLifecycleController";
import { createStore, type AppStore } from "@/store";
import { useAppSelector } from "@/store/hooks";
import {
  appBackgrounded,
  appForegrounded,
  setOnline,
} from "@/store/slices/lifecycleSlice";
import { ThemeProvider, useTheme } from "@/theme/ThemeContext";
import { toNavigationTheme } from "@/theme/navigationTheme";

export default function App() {
  // Adapters are built once and threaded into the store factory — the same
  // wiring @thewired/core will consume at Phase 0.
  const [store] = useState<AppStore>(() => createStore(createMobileAdapters()));

  useMobileLifecycle(store);

  // Cold-start session hydration: keychain → signer → loggedIn/loggedOut.
  // RootNavigator shows a splash while identity.status === "hydrating".
  useEffect(() => {
    store.dispatch(hydrateSession());
  }, [store]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StoreProvider store={store}>
          <ThemeProvider>
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
  const { themeVars, tokens, isDark } = useTheme();
  const sessionStatus = useAppSelector((s) => s.identity.status);
  const navTheme = useMemo(() => toNavigationTheme(tokens, isDark), [tokens, isDark]);

  return (
    <View style={[{ flex: 1 }, themeVars]}>
      {sessionStatus === "hydrating" ? (
        // Keychain read in flight — hold a blank themed frame instead of
        // flashing the Welcome screen at already-logged-in users.
        <View className="flex-1 items-center justify-center bg-background">
          <Spinner size="lg" />
        </View>
      ) : (
        <>
          <OfflineBanner />
          <NavigationContainer theme={navTheme} linking={linking}>
            <RootNavigator />
          </NavigationContainer>
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
    <View className="items-center bg-warning px-4 py-1">
      <Text className="text-xs font-medium text-background">
        Offline — reconnecting when the network returns
      </Text>
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
