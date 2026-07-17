import { screen } from "@testing-library/react-native";

import { OfflineNotice } from "../OfflineBanner";
import { renderWithTheme } from "@/test/renderWithTheme";

describe("OfflineNotice", () => {
  it("renders the copy on a hairline surface — no warning fill", async () => {
    await renderWithTheme(<OfflineNotice />);
    const text = screen.getByText(/offline — reconnecting/);
    expect(text).toBeTruthy();
    // Status without color: the pill is a bordered panel, not bg-warning.
    const pill = text.parent?.parent as { props: { className?: string } } | null;
    const className = pill?.props?.className ?? "";
    expect(className).not.toContain("bg-warning");
  });
});
