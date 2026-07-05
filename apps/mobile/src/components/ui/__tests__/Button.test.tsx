import { screen, userEvent } from "@testing-library/react-native";
import { Text } from "react-native";

import { Button } from "../Button";
import { renderWithTheme } from "@/test/renderWithTheme";

jest.mock("expo-haptics", () => ({
  selectionAsync: jest.fn().mockResolvedValue(undefined),
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: "light" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}));

const haptics = jest.requireMock("expo-haptics") as {
  selectionAsync: jest.Mock;
  impactAsync: jest.Mock;
};

describe("Button", () => {
  beforeEach(() => {
    haptics.selectionAsync.mockClear();
    haptics.impactAsync.mockClear();
  });

  it("renders a string child inside a Text", async () => {
    await renderWithTheme(<Button onPress={() => {}}>Save</Button>);
    expect(screen.getByText("Save")).toBeTruthy();
  });

  it("renders non-string children as-is", async () => {
    await renderWithTheme(
      <Button onPress={() => {}}>
        <Text>Custom</Text>
      </Button>,
    );
    expect(screen.getByText("Custom")).toBeTruthy();
  });

  it("fires onPress with a light impact on primary variants", async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderWithTheme(<Button onPress={onPress}>Go</Button>);

    await user.press(screen.getByRole("button"));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(haptics.impactAsync).toHaveBeenCalled();
    expect(haptics.selectionAsync).not.toHaveBeenCalled();
  });

  it("uses a selection tick for secondary variants", async () => {
    const user = userEvent.setup();
    await renderWithTheme(
      <Button variant="secondary" onPress={() => {}}>
        Softly
      </Button>,
    );

    await user.press(screen.getByRole("button"));
    expect(haptics.selectionAsync).toHaveBeenCalled();
    expect(haptics.impactAsync).not.toHaveBeenCalled();
  });

  it("does not fire when disabled", async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderWithTheme(
      <Button onPress={onPress} disabled>
        Nope
      </Button>,
    );

    await user.press(screen.getByText("Nope"));
    expect(onPress).not.toHaveBeenCalled();
  });

  it("blocks presses and shows a spinner while loading", async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderWithTheme(
      <Button onPress={onPress} loading>
        Publish
      </Button>,
    );

    expect(screen.queryByText("Publish")).toBeNull();
    await user.press(screen.getByRole("button"));
    expect(onPress).not.toHaveBeenCalled();
  });

  it("skips haptics when haptic={false}", async () => {
    const user = userEvent.setup();
    await renderWithTheme(
      <Button onPress={() => {}} haptic={false}>
        Silent
      </Button>,
    );

    await user.press(screen.getByRole("button"));
    expect(haptics.selectionAsync).not.toHaveBeenCalled();
    expect(haptics.impactAsync).not.toHaveBeenCalled();
  });
});
