import { Text, type TextProps } from "react-native";

import { cn } from "@/lib/cn";
import { useTheme } from "@/theme/ThemeContext";
import type { FontWeightKey, TypeRole } from "@/theme/typography";

// The app's text primitive: role from the type scale + color from the theme
// class vocabulary. Size/leading/tracking/family come from the role (and the
// active preset's font), so screens only pick a role and a color class:
//   <Type role="title" className="text-heading">Settings</Type>

// Omit RN's accessibility `role` — Type reuses the name for the type-scale
// role (use accessibilityRole for a11y semantics if ever needed on text).
export interface TypeProps extends Omit<TextProps, "role"> {
  role?: TypeRole;
  /** Tabular figures for counts/balances (no shift as digits change). */
  tabular?: boolean;
  /** Override the role's default weight (400/500/600/700). */
  weight?: FontWeightKey;
  className?: string;
}

export function Type({
  role = "body",
  tabular,
  weight,
  className,
  style,
  children,
  ...rest
}: TypeProps) {
  const { type } = useTheme();
  return (
    <Text
      className={cn("text-body", className)}
      style={[type(role, { tabular, weight }), style]}
      {...rest}
    >
      {children}
    </Text>
  );
}
