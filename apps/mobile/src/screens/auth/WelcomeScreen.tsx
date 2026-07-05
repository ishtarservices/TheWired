import { useNavigation } from "@react-navigation/native";
import { KeyRound, UserPlus } from "lucide-react-native";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/ui/Button";
import { useTheme } from "@/theme/ThemeContext";

export function WelcomeScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { tokens } = useTheme();

  return (
    <View
      className="flex-1 bg-background px-6"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom + 16 }}
    >
      {/* Branding */}
      <View className="flex-1 items-center justify-center">
        <Text className="text-4xl font-bold tracking-widest text-heading">
          THE WIRED
        </Text>
        <Text className="mt-3 text-center text-sm leading-5 text-soft">
          Spaces, music and messages on Nostr.{"\n"}
          Your identity is a key — no email, no password, no account server.
        </Text>
      </View>

      {/* Actions */}
      <View className="gap-3">
        <Button
          size="lg"
          onPress={() => navigation.navigate("CreateIdentity")}
        >
          <UserPlus size={18} color={tokens.primaryForeground} />
          <Text className="text-base font-medium text-primary-fg">
            Create a new identity
          </Text>
        </Button>
        <Button
          size="lg"
          variant="secondary"
          onPress={() => navigation.navigate("Login")}
        >
          <KeyRound size={18} color={tokens.body} />
          <Text className="text-base font-medium text-body">
            I already have a key
          </Text>
        </Button>
        <Text className="mt-1 text-center text-xs leading-4 text-muted">
          Your secret key is stored in this device's keychain and never leaves
          it without your say-so.
        </Text>
      </View>
    </View>
  );
}
