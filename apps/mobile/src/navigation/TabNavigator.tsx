// Bottom tabs = the desktop's four sidebarMode values + You (guide 03 §2).
// Native tab semantics give us the keep-alive the desktop faked with `hidden`
// classes (audio keeps playing, AI keeps streaming across tab switches).
//
// W1 chrome: the bar is glass — expo-blur behind a translucent wash of the
// theme background, absolutely positioned so content scrolls beneath it.
// Screens pad their bottom edge via useBottomTabBarHeight (Screen component).

import { Platform, StyleSheet, View } from "react-native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { BlurView } from "expo-blur";
import { BrainCircuit, Boxes, CircleUser, MessageCircle, Music } from "lucide-react-native";
import type { LucideProps } from "lucide-react-native";
import type { ComponentType } from "react";

import { AIStack, MessagesStack, MusicStack, SpacesStack, YouStack } from "./stacks";
import type { MainTabParamList } from "./types";
import { haptics } from "@/lib/haptics";
import { GLASS_BLUR_INTENSITY } from "@/theme/constants";
import { withAlpha } from "@/theme/engine";
import { useTheme } from "@/theme/ThemeContext";

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
  const { tokens } = useTheme();
  return (
    <View
      style={
        focused && Platform.OS === "ios"
          ? {
              // Soft glow behind the active icon (iOS shadow-as-glow).
              shadowColor: tokens.primary,
              shadowOpacity: 0.55,
              shadowRadius: 10,
              shadowOffset: { width: 0, height: 0 },
            }
          : undefined
      }
    >
      <Icon color={color} size={24} strokeWidth={focused ? 2.25 : 1.75} />
    </View>
  );
}

function GlassTabBackground() {
  const { config, extras, isDark } = useTheme();
  if (Platform.OS !== "ios") {
    return (
      <View style={[StyleSheet.absoluteFill, { backgroundColor: extras.glassBg }]} />
    );
  }
  return (
    <BlurView
      intensity={GLASS_BLUR_INTENSITY * 3}
      tint={isDark ? "dark" : "light"}
      style={StyleSheet.absoluteFill}
    >
      {/* Theme wash over the system blur so the bar carries the preset hue. */}
      <View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: withAlpha(config.colors.background, 0.55) },
        ]}
      />
    </BlurView>
  );
}

export function TabNavigator() {
  const { tokens, extras, type } = useTheme();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: tokens.primary,
        tabBarInactiveTintColor: tokens.muted,
        tabBarBackground: () => <GlassTabBackground />,
        tabBarStyle: {
          position: "absolute",
          backgroundColor: "transparent",
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: extras.glassBorder,
          elevation: 0,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontFamily: type("micro").fontFamily,
        },
      }}
      screenListeners={{
        tabPress: () => haptics.selection(),
      }}
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
