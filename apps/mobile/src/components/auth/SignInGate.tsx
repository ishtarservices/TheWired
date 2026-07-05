import { useNavigation } from "@react-navigation/native";
import { KeyRound } from "lucide-react-native";
import { View } from "react-native";

import { Button } from "@/components/ui/Button";
import { Type } from "@/components/ui/Type";
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
      <View className="w-full max-w-[360px] items-center">
        <View className="h-16 w-16 items-center justify-center rounded-full bg-primary-dim">
          <KeyRound size={26} color={tokens.primary} strokeWidth={1.75} />
        </View>
        <Type role="title" className="mt-5 text-center text-heading">
          {title}
        </Type>
        <Type role="caption" className="mt-2 max-w-[300px] text-center leading-5 text-muted">
          {message}
        </Type>
        <View className="mt-7 w-full gap-2.5">
          <Button size="lg" onPress={() => navigation.navigate("CreateIdentity")}>
            Create a new identity
          </Button>
          <Button size="lg" variant="secondary" onPress={() => navigation.navigate("Login")}>
            Log in with my key
          </Button>
        </View>
      </View>
    </View>
  );
}
