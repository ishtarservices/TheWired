import { useNavigation } from "@react-navigation/native";
import { KeyRound } from "lucide-react-native";
import { Text, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { useTheme } from "@/theme/ThemeContext";

// Shown in place of account-based surfaces while browsing as a guest
// (App Store 5.1.1(v): public content stays open; account features may
// require sign-in). The auth screens are available as modals in guest mode,
// so signing in happens in place without losing the browsing session.

export interface SignInGateProps {
  /** What the user is missing, e.g. "Messages". */
  title: string;
  /** Why a key is needed for it. */
  message: string;
}

export function SignInGate({ title, message }: SignInGateProps) {
  const navigation = useNavigation();
  const { tokens } = useTheme();

  return (
    <View className="flex-1 items-center justify-center bg-background px-6">
      <View className="w-full items-center rounded-lg border border-border bg-card p-6">
        <KeyRound size={28} color={tokens.muted} />
        <Text className="mt-3 text-base font-semibold text-heading">{title}</Text>
        <Text className="mt-1 text-center text-sm leading-5 text-soft">{message}</Text>
        <View className="mt-5 w-full gap-2">
          <Button onPress={() => navigation.navigate("CreateIdentity")}>
            Create a new identity
          </Button>
          <Button variant="secondary" onPress={() => navigation.navigate("Login")}>
            Log in with my key
          </Button>
        </View>
      </View>
    </View>
  );
}
