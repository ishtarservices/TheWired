import { render, screen, userEvent } from "@testing-library/react-native";
import { Text } from "react-native";

import { Button } from "../Button";

jest.mock("expo-haptics", () => ({
  selectionAsync: jest.fn().mockResolvedValue(undefined),
}));

const haptics = jest.requireMock("expo-haptics") as { selectionAsync: jest.Mock };

describe("Button", () => {
  beforeEach(() => {
    haptics.selectionAsync.mockClear();
  });

  it("renders a string child inside a Text", async () => {
    await render(<Button onPress={() => {}}>Save</Button>);
    expect(screen.getByText("Save")).toBeTruthy();
  });

  it("renders non-string children as-is", async () => {
    await render(
      <Button onPress={() => {}}>
        <Text>Custom</Text>
      </Button>,
    );
    expect(screen.getByText("Custom")).toBeTruthy();
  });

  it("fires onPress and ticks haptics on press-in", async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await render(<Button onPress={onPress}>Go</Button>);

    await user.press(screen.getByRole("button"));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(haptics.selectionAsync).toHaveBeenCalled();
  });

  it("does not fire when disabled", async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await render(
      <Button onPress={onPress} disabled>
        Nope
      </Button>,
    );

    await user.press(screen.getByText("Nope"));
    expect(onPress).not.toHaveBeenCalled();
  });

  it("skips haptics when haptic={false}", async () => {
    const user = userEvent.setup();
    await render(
      <Button onPress={() => {}} haptic={false}>
        Silent
      </Button>,
    );

    await user.press(screen.getByRole("button"));
    expect(haptics.selectionAsync).not.toHaveBeenCalled();
  });
});
