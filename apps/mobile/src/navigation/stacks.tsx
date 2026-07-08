// One native stack per tab (guide 03 §2). Drill-down = push/pop with the OS
// back gesture — replaces the desktop TopBar ◀ ▶ + Redux history stack.
// Tab roots use the iOS large-title pattern (collapses into glass on scroll).

import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { useLargeTitleScreenOptions, useStackScreenOptions } from "./screenOptions";
import type {
  AIStackParamList,
  MessagesStackParamList,
  MusicStackParamList,
  SpacesStackParamList,
  YouStackParamList,
} from "./types";
import { AIChatListScreen } from "@/screens/ai/AIChatListScreen";
import { AIConversationScreen } from "@/screens/ai/AIConversationScreen";
import { DMConversationScreen } from "@/screens/messages/DMConversationScreen";
import { DMListScreen } from "@/screens/messages/DMListScreen";
import { AlbumScreen } from "@/screens/music/AlbumScreen";
import { MusicHomeScreen } from "@/screens/music/MusicHomeScreen";
import { ChannelScreen } from "@/screens/spaces/ChannelScreen";
import { DiscoverScreen } from "@/screens/spaces/DiscoverScreen";
import { SpaceFeedScreen } from "@/screens/spaces/SpaceFeedScreen";
import { SpaceMembersScreen } from "@/screens/spaces/SpaceMembersScreen";
import { SpaceScreen } from "@/screens/spaces/SpaceScreen";
import { SpacesHomeScreen } from "@/screens/spaces/SpacesHomeScreen";
import { ThreadScreen } from "@/screens/spaces/ThreadScreen";
import { SettingsScreen } from "@/screens/you/SettingsScreen";
import { YouScreen } from "@/screens/you/YouScreen";

const Spaces = createNativeStackNavigator<SpacesStackParamList>();
export function SpacesStack() {
  const large = useLargeTitleScreenOptions();
  return (
    <Spaces.Navigator screenOptions={useStackScreenOptions()}>
      <Spaces.Screen name="SpacesHome" component={SpacesHomeScreen} options={{ title: "Spaces" }} />
      <Spaces.Screen
        name="Discover"
        component={DiscoverScreen}
        options={{ ...large, title: "Discover" }}
      />
      <Spaces.Screen name="Space" component={SpaceScreen} options={{ title: "Space" }} />
      <Spaces.Screen name="Channel" component={ChannelScreen} options={{ title: "Channel" }} />
      <Spaces.Screen
        name="SpaceFeed"
        component={SpaceFeedScreen}
        options={({ route }) => ({ title: `#${route.params.label}` })}
      />
      <Spaces.Screen
        name="SpaceMembers"
        component={SpaceMembersScreen}
        options={{ title: "Members" }}
      />
      <Spaces.Screen name="Thread" component={ThreadScreen} options={{ title: "Thread" }} />
    </Spaces.Navigator>
  );
}

const Music = createNativeStackNavigator<MusicStackParamList>();
export function MusicStack() {
  const large = useLargeTitleScreenOptions();
  return (
    <Music.Navigator screenOptions={useStackScreenOptions()}>
      <Music.Screen
        name="MusicHome"
        component={MusicHomeScreen}
        options={{ ...large, title: "Music" }}
      />
      <Music.Screen name="Album" component={AlbumScreen} options={{ title: "Album" }} />
    </Music.Navigator>
  );
}

const Messages = createNativeStackNavigator<MessagesStackParamList>();
export function MessagesStack() {
  const large = useLargeTitleScreenOptions();
  return (
    <Messages.Navigator screenOptions={useStackScreenOptions()}>
      <Messages.Screen
        name="DMList"
        component={DMListScreen}
        options={{ ...large, title: "Messages" }}
      />
      <Messages.Screen
        name="DMConversation"
        component={DMConversationScreen}
        options={{ title: "Conversation" }}
      />
    </Messages.Navigator>
  );
}

const AI = createNativeStackNavigator<AIStackParamList>();
export function AIStack() {
  const large = useLargeTitleScreenOptions();
  return (
    <AI.Navigator screenOptions={useStackScreenOptions()}>
      <AI.Screen
        name="AIChatList"
        component={AIChatListScreen}
        options={{ ...large, title: "AI" }}
      />
      <AI.Screen
        name="AIConversation"
        component={AIConversationScreen}
        options={{ title: "Conversation" }}
      />
    </AI.Navigator>
  );
}

const You = createNativeStackNavigator<YouStackParamList>();
export function YouStack() {
  const large = useLargeTitleScreenOptions();
  return (
    <You.Navigator screenOptions={useStackScreenOptions()}>
      <You.Screen name="You" component={YouScreen} options={{ ...large, title: "You" }} />
      <You.Screen name="Settings" component={SettingsScreen} options={{ title: "Settings" }} />
    </You.Navigator>
  );
}
