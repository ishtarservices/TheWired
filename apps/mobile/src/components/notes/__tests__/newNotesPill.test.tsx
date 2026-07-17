import { screen, userEvent } from "@testing-library/react-native";

import { NewNotesPill } from "../NewNotesPill";
import { renderWithTheme } from "@/test/renderWithTheme";

jest.mock("expo-haptics", () => ({
  selectionAsync: jest.fn().mockResolvedValue(undefined),
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: "light" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}));

jest.useFakeTimers();

describe("NewNotesPill", () => {
  it("renders the lowercase protocol-voice count", async () => {
    await renderWithTheme(<NewNotesPill count={12} topOffset={8} onPress={() => {}} />);
    expect(screen.getByText("12 new notes")).toBeOnTheScreen();
  });

  it("uses the singular for one note", async () => {
    await renderWithTheme(<NewNotesPill count={1} topOffset={8} onPress={() => {}} />);
    expect(screen.getByText("1 new note")).toBeOnTheScreen();
  });

  it("caps the label at 99+", async () => {
    await renderWithTheme(<NewNotesPill count={250} topOffset={8} onPress={() => {}} />);
    expect(screen.getByText("99+ new notes")).toBeOnTheScreen();
  });

  it("fires onPress with a selection haptic", async () => {
    const haptics = jest.requireMock("expo-haptics") as { selectionAsync: jest.Mock };
    const user = userEvent.setup();
    const onPress = jest.fn();
    await renderWithTheme(<NewNotesPill count={3} topOffset={8} onPress={onPress} />);

    await user.press(screen.getByRole("button", { name: "3 new notes — scroll to top" }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(haptics.selectionAsync).toHaveBeenCalled();
  });
});
