// Root stack above the tabs (guide 03 §2): cross-cutting screens any tab can
// push (they cover the tab bar) + modal/sheet presentations. Also the auth
// gate: while logged out only the auth screens exist, so the swap on login/
// logout is automatic and nothing can navigate back across it
// (react-navigation's conditional-screens pattern).

import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { useStackScreenOptions } from "./screenOptions";
import { TabNavigator } from "./TabNavigator";
import type { RootStackParamList } from "./types";
import { CreateIdentityScreen } from "@/screens/auth/CreateIdentityScreen";
import { LoginScreen } from "@/screens/auth/LoginScreen";
import { WelcomeScreen } from "@/screens/auth/WelcomeScreen";
import { ArticleScreen } from "@/screens/shared/ArticleScreen";
import { ComposerScreen } from "@/screens/shared/ComposerScreen";
import { IncomingCallScreen } from "@/screens/shared/IncomingCallScreen";
import { JoinSpaceScreen } from "@/screens/shared/JoinSpaceScreen";
import { MediaLightboxScreen } from "@/screens/shared/MediaLightboxScreen";
import { NoteThreadScreen } from "@/screens/shared/NoteThreadScreen";
import { NowPlayingScreen } from "@/screens/shared/NowPlayingScreen";
import { ProfileScreen } from "@/screens/shared/ProfileScreen";
import { useAppSelector } from "@/store/hooks";

const Root = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const sessionStatus = useAppSelector((s) => s.identity.status);
  const screenOptions = useStackScreenOptions();

  return (
    <Root.Navigator screenOptions={screenOptions}>
      {sessionStatus === "loggedOut" ? (
        <Root.Group>
          <Root.Screen name="Welcome" component={WelcomeScreen} options={{ headerShown: false }} />
          <Root.Screen
            name="CreateIdentity"
            component={CreateIdentityScreen}
            options={{ title: "Create your identity" }}
          />
          <Root.Screen name="Login" component={LoginScreen} options={{ title: "Log in" }} />
        </Root.Group>
      ) : (
        <>
          <Root.Screen name="Tabs" component={TabNavigator} options={{ headerShown: false }} />

          {/* Cross-cutting pushes */}
          <Root.Screen name="Profile" component={ProfileScreen} options={{ title: "Profile" }} />
          <Root.Screen name="NoteThread" component={NoteThreadScreen} options={{ title: "Thread" }} />
          <Root.Screen name="Article" component={ArticleScreen} options={{ title: "Article" }} />

          {/* Sheet-style modals */}
          <Root.Group screenOptions={{ presentation: "modal" }}>
            <Root.Screen name="JoinSpace" component={JoinSpaceScreen} options={{ title: "Join Space" }} />
            <Root.Screen name="NowPlaying" component={NowPlayingScreen} options={{ title: "Now Playing" }} />
            <Root.Screen
              name="Composer"
              component={ComposerScreen}
              options={{ headerShown: false }}
            />
          </Root.Group>

          {/* Full-screen takeovers */}
          <Root.Group screenOptions={{ presentation: "fullScreenModal", headerShown: false }}>
            <Root.Screen name="MediaLightbox" component={MediaLightboxScreen} />
            <Root.Screen name="IncomingCall" component={IncomingCallScreen} />
          </Root.Group>

          {/* Guest mode: auth reachable as modals so signing in from a
              SignInGate doesn't lose the browsing session. On success the
              status flips and this whole branch re-renders logged-in. */}
          {sessionStatus === "guest" ? (
            <Root.Group screenOptions={{ presentation: "modal" }}>
              <Root.Screen
                name="CreateIdentity"
                component={CreateIdentityScreen}
                options={{ title: "Create your identity" }}
              />
              <Root.Screen name="Login" component={LoginScreen} options={{ title: "Log in" }} />
            </Root.Group>
          ) : null}
        </>
      )}
    </Root.Navigator>
  );
}
