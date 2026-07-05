import { render, screen, userEvent } from "@testing-library/react-native";

const mockNavigate = jest.fn();
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ navigate: mockNavigate }),
}));

import { SignInGate } from "../SignInGate";
import { ThemeProvider } from "@/theme/ThemeContext";

describe("SignInGate", () => {
  beforeEach(() => mockNavigate.mockClear());

  it("shows the reason and routes to the auth modals", async () => {
    const user = userEvent.setup();
    await render(
      <ThemeProvider>
        <SignInGate title="Messages need an identity" message="Encrypted to your key." />
      </ThemeProvider>,
    );

    expect(screen.getByText("Messages need an identity")).toBeTruthy();
    expect(screen.getByText("Encrypted to your key.")).toBeTruthy();

    await user.press(screen.getByText("Create a new identity"));
    expect(mockNavigate).toHaveBeenCalledWith("CreateIdentity");

    await user.press(screen.getByText("Log in with my key"));
    expect(mockNavigate).toHaveBeenCalledWith("Login");
  });
});
