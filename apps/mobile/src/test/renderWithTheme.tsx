import type { ReactElement } from "react";
import { render } from "@testing-library/react-native";

import { ThemeProvider } from "@/theme/ThemeContext";

/** Render inside ThemeProvider — required by every design-system component
 *  (Type/Button/Card/… all read the theme context). */
export function renderWithTheme(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}
