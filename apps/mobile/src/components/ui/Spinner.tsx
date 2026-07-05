import { ActivityIndicator, type ViewProps } from "react-native";

import { useTheme } from "@/theme/ThemeContext";

export interface SpinnerProps extends ViewProps {
  size?: "sm" | "lg";
  /** Overrides the theme primary color. */
  color?: string;
}

export function Spinner({ size = "sm", color, ...rest }: SpinnerProps) {
  const { tokens } = useTheme();
  return (
    <ActivityIndicator
      size={size === "lg" ? "large" : "small"}
      color={color ?? tokens.primary}
      {...rest}
    />
  );
}
