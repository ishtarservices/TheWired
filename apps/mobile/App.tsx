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
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
} from "@expo-google-fonts/jetbrains-mono";

import { hydrateSession } from "@/auth/session";
import { GrainOverlay } from "@/components/layout/GrainOverlay";
import { OfflineBanner } from "@/components/layout/OfflineBanner";
import { createNostrEngine, type NostrEngine } from "@/lib/nostr/engine";
import { EngineProvider } from "@/lib/nostr/EngineContext";
import { TimeTickProvider } from "@/lib/timeTick";
import { linking } from "@/navigation/linking";
import { RootNavigator } from "@/navigation/RootNavigator";
import { createMobileAdapters } from "@/platform/adapters";
import { getStoredThemePreset } from "@/platform/appPrefs";
import { MobileLifecycleController } from "@/platform/lifecycle/MobileLifecycleController";
import { createStore, type AppStore } from "@/store";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { hydrateModeration } from "@/store/moderation";
import { hydrateMySpaces } from "@/store/spaceMeta";
import { hydrateSpacePreviews } from "@/store/spacePreviews";
import { spaceChatCleared } from "@/store/slices/spaceChatSlice";
import { spaceMetaCleared } from "@/store/slices/spaceMetaSlice";
import { spacePreviewsCleared } from "@/store/slices/spacePreviewsSlice";
import {
  appBackgrounded,
  appForegrounded,
  setOnline,
} from "@/store/slices/lifecycleSlice";
import { selectAnyRelayConnected } from "@/store/slices/relaysSlice";
import { ThemeProvider, useTheme } from "@/theme/ThemeContext";
import { navigationFonts, toNavigationTheme } from "@/theme/navigationTheme";
import { DEFAULT_PRESET } from "@/theme/presets";
import { setFontsReady } from "@/theme/typography";

export default function App() {
  // Adapters are built once and threaded into the store factory — the same
  // wiring @thewired/core will consume at Phase 0. The engine (relay pool +
  // event pipeline) rides on the same adapters and store.
  const [{ store, engine }] = useState(() => {
    const adapters = createMobileAdapters();
    const appStore = createStore(adapters);
    const nostrEngine = createNostrEngine({
      adapters,
      dispatch: appStore.dispatch,
      getState: appStore.getState,
    });
    return { store: appStore, engine: nostrEngine };
  });

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
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
  });
  const fontsReady = fontsLoaded || !!fontError;
  setFontsReady(fontsLoaded);

  // Persisted theme preset, read before first themed paint so returning
  // light-theme users don't get a dark flash (and vice versa).
  const [initialPreset, setInitialPreset] = useState<string | null>(null);
  useEffect(() => {
    getStoredThemePreset().then((stored) => setInitialPreset(stored ?? DEFAULT_PRESET));
  }, []);

  useMobileLifecycle(store, engine);

  // Cold-start session hydration: keychain → signer → loggedIn/loggedOut.
  // RootNavigator shows a splash while identity.status === "hydrating".
  useEffect(() => {
    store.dispatch(hydrateSession());
  }, [store]);

  useEffect(() => () => engine.destroy(), [engine]);

  if (!fontsReady || initialPreset === null) {
    // Bare frame matching app.json backgroundColor — fonts + preset resolve
    // in well under a second; rendering text now would flash system fonts.
    return <View style={{ flex: 1, backgroundColor: "#0a0a0a" }} />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StoreProvider store={store}>
          <EngineProvider engine={engine}>
            <ThemeProvider initialPreset={initialPreset}>
              <ThemedShell engine={engine} />
            </ThemeProvider>
          </EngineProvider>
        </StoreProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/** Inside ThemeProvider — spreads the NativeWind vars() on the root View so
 *  every className below resolves the active preset's tokens. */
function ThemedShell({ engine }: { engine: NostrEngine }) {
  const { themeVars, tokens, isDark, config } = useTheme();
  const sessionStatus = useAppSelector((s) => s.identity.status);
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const navTheme = useMemo(() => toNavigationTheme(tokens, isDark), [tokens, isDark]);
  const navFonts = useMemo(() => navigationFonts(config.font?.family), [config]);

  // Engine start + identity sync: start once the session resolves (so the
  // right per-account DB hydrates), then track login/logout/account switch.
  const dispatch = useAppDispatch();
  const engineStarted = sessionStatus !== "hydrating";
  useEffect(() => {
    if (!engineStarted) return;
    // Account switch: previews/read-state/chat backlogs/space meta must not
    // leak across identities — clear, then rehydrate from the (per-account)
    // storage that just opened (chat/space meta re-hydrate lazily per key).
    dispatch(spacePreviewsCleared());
    dispatch(spaceChatCleared());
    dispatch(spaceMetaCleared());
    engine
      .start(pubkey)
      .then(() => {
        dispatch(hydrateModeration());
        dispatch(hydrateSpacePreviews());
        dispatch(hydrateMySpaces());
      })
      .catch(() => {});
  }, [engine, engineStarted, pubkey, dispatch]);
  useEffect(() => {
    if (!engineStarted) return;
    engine.setIdentity(pubkey).catch(() => {});
  }, [engine, engineStarted, pubkey]);

  return (
    <View style={[{ flex: 1 }, themeVars]}>
      {sessionStatus === "hydrating" ? (
        // Keychain read in flight — hold a blank themed frame instead of
        // flashing the Welcome screen at already-logged-in users.
        <View className="flex-1 bg-background" />
      ) : (
        <TimeTickProvider>
          <NavigationContainer theme={{ ...navTheme, fonts: navFonts }} linking={linking}>
            <RootNavigator />
          </NavigationContainer>
          <OfflineBanner />
        </TimeTickProvider>
      )}
      <GrainOverlay />
      <StatusBar style={isDark ? "light" : "dark"} />
    </View>
  );
}

/** AppState + NetInfo → Redux + engine (guide 06 §2): background closes the
 *  pool gracefully, foreground reconnects + resubscribes with fresh `since`,
 *  connectivity return reconnects immediately instead of waiting out backoff.
 *  NetInfo lies on iOS, so relay sockets double as connectivity evidence:
 *  the controller consults live socket state whenever NetInfo claims
 *  offline, and a socket reaching "connected" while the banner is up pushes
 *  the recovery through reportOnlineEvidence(). */
function useMobileLifecycle(store: AppStore, engine: NostrEngine) {
  useEffect(() => {
    const controller = new MobileLifecycleController(
      {
        onForeground: () => {
          store.dispatch(appForegrounded({ at: Date.now() }));
          engine.handleForeground();
        },
        onBackground: () => {
          store.dispatch(appBackgrounded());
          engine.handleBackground();
        },
        onOnline: () => {
          store.dispatch(setOnline(true));
          engine.handleOnline();
        },
        onOffline: () => store.dispatch(setOnline(false)),
      },
      { hasConnectivityEvidence: () => selectAnyRelayConnected(store.getState()) },
    );
    controller.start();
    const unsubscribe = store.subscribe(() => {
      const s = store.getState();
      if (!s.lifecycle.isOnline && selectAnyRelayConnected(s)) {
        controller.reportOnlineEvidence();
      }
    });
    return () => {
      unsubscribe();
      controller.stop();
    };
  }, [store, engine]);
}
