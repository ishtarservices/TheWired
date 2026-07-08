import { useEffect } from "react";
import { Pressable } from "react-native";
import { ChevronLeft } from "lucide-react-native";
import type { NativeStackNavigationOptions } from "@react-navigation/native-stack";

import { useTheme } from "@/theme/ThemeContext";

// Deep links mount nested screens as SINGLE-ROUTE states (linking.ts — the
// iOS-26 multi-push workaround), so there's no parent beneath and the native
// back chevron never renders. This injects an explicit "up" affordance that
// replaces the screen with its logical parent. No-op on normal pushes.

interface FallbackNavigation {
  canGoBack(): boolean;
  setOptions(options: Partial<NativeStackNavigationOptions>): void;
}

/** `onUp` must be referentially stable (useCallback) and should
 *  `navigation.replace(...)` to the screen's logical parent. */
export function useBackFallback(navigation: FallbackNavigation, onUp: () => void): void {
  const { tokens } = useTheme();
  useEffect(() => {
    if (navigation.canGoBack()) return;
    navigation.setOptions({
      headerLeft: () => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
          onPress={onUp}
        >
          <ChevronLeft size={26} color={tokens.primary} strokeWidth={2.25} />
        </Pressable>
      ),
    });
  }, [navigation, onUp, tokens]);
}
