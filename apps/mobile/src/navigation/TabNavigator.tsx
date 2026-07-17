// Bottom tabs = the desktop's four sidebarMode values + You (guide 03 §2).
// Native tab semantics give us the keep-alive the desktop faked with `hidden`
// classes (audio keeps playing, AI keeps streaming across tab switches).
//
// Chrome is the floating glass pill (FloatingTabBar) — icons only, the
// sliding primary circle marks the active tab. Screens pad their bottom edge
// via useScreenInsets (components/layout/Screen); the pill reports its real
// height through BottomTabBarHeightCallbackContext.

import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { BrainCircuit, Boxes, CircleUser, MessageCircle, Music } from "lucide-react-native";
import type { LucideProps } from "lucide-react-native";
import type { ComponentType } from "react";

import { FloatingTabBar } from "./FloatingTabBar";
import { AIStack, MessagesStack, MusicStack, SpacesStack, YouStack } from "./stacks";
import { tabResetAction } from "./tabReset";
import type { MainTabParamList } from "./types";
import { haptics } from "@/lib/haptics";

const Tab = createBottomTabNavigator<MainTabParamList>();

function TabIcon({
  icon: Icon,
  color,
  focused,
}: {
  icon: ComponentType<LucideProps>;
  color: string;
  focused: boolean;
}) {
  return <Icon color={color} size={22} strokeWidth={focused ? 2.25 : 1.75} />;
}

/** Each tab's root screen — re-pressing the active tab resets to it. */
const TAB_ROOTS: Record<keyof MainTabParamList, string> = {
  SpacesTab: "SpacesHome",
  MusicTab: "MusicHome",
  MessagesTab: "DMList",
  AITab: "AIChatList",
  YouTab: "You",
};

export function TabNavigator() {
  return (
    <Tab.Navigator
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{ headerShown: false }}
      screenListeners={({ navigation, route }) => ({
        tabPress: (e) => {
          haptics.selection();
          // Re-press on the already-active tab → back to that tab's root
          // (also the only way out of a deep-linked single-route stack).
          if (!navigation.isFocused()) return;
          // Own the re-press: the default POP_TO_TOP can't handle a
          // single-route stack (dev warning) — swap in a scoped reset.
          e.preventDefault();
          const childState = navigation
            .getState()
            .routes.find((r) => r.key === route.key)?.state;
          const action = tabResetAction(childState, TAB_ROOTS[route.name]);
          if (action) navigation.dispatch(action);
        },
      })}
    >
      <Tab.Screen
        name="SpacesTab"
        component={SpacesStack}
        options={{
          title: "Spaces",
          tabBarIcon: (p) => <TabIcon icon={Boxes} {...p} />,
        }}
      />
      <Tab.Screen
        name="MusicTab"
        component={MusicStack}
        options={{
          title: "Music",
          tabBarIcon: (p) => <TabIcon icon={Music} {...p} />,
        }}
      />
      <Tab.Screen
        name="MessagesTab"
        component={MessagesStack}
        options={{
          title: "Messages",
          tabBarIcon: (p) => <TabIcon icon={MessageCircle} {...p} />,
        }}
      />
      <Tab.Screen
        name="AITab"
        component={AIStack}
        options={{
          title: "AI",
          tabBarIcon: (p) => <TabIcon icon={BrainCircuit} {...p} />,
        }}
      />
      <Tab.Screen
        name="YouTab"
        component={YouStack}
        options={{
          title: "You",
          tabBarIcon: (p) => <TabIcon icon={CircleUser} {...p} />,
        }}
      />
    </Tab.Navigator>
  );
}
