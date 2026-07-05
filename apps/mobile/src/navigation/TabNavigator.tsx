// Bottom tabs = the desktop's four sidebarMode values + You (guide 03 §2).
// Native tab semantics give us the keep-alive the desktop faked with `hidden`
// classes (audio keeps playing, AI keeps streaming across tab switches).

import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Boxes, CircleUser, MessageCircle, Music, Sparkles } from "lucide-react-native";

import { AIStack, MessagesStack, MusicStack, SpacesStack, YouStack } from "./stacks";
import type { MainTabParamList } from "./types";
import { useTheme } from "@/theme/ThemeContext";

const Tab = createBottomTabNavigator<MainTabParamList>();

export function TabNavigator() {
  const { tokens } = useTheme();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: tokens.primary,
        tabBarInactiveTintColor: tokens.muted,
        tabBarStyle: {
          backgroundColor: tokens.panel,
          borderTopColor: tokens.border,
        },
      }}
    >
      <Tab.Screen
        name="SpacesTab"
        component={SpacesStack}
        options={{
          title: "Spaces",
          tabBarIcon: ({ color, size }) => <Boxes color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="MusicTab"
        component={MusicStack}
        options={{
          title: "Music",
          tabBarIcon: ({ color, size }) => <Music color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="MessagesTab"
        component={MessagesStack}
        options={{
          title: "Messages",
          tabBarIcon: ({ color, size }) => <MessageCircle color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="AITab"
        component={AIStack}
        options={{
          title: "AI",
          tabBarIcon: ({ color, size }) => <Sparkles color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="YouTab"
        component={YouStack}
        options={{
          title: "You",
          tabBarIcon: ({ color, size }) => <CircleUser color={color} size={size} />,
        }}
      />
    </Tab.Navigator>
  );
}
