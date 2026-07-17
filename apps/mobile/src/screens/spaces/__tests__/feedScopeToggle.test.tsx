import { screen, userEvent } from "@testing-library/react-native";

import { FeedScopeToggle } from "../components/FeedScopeToggle";
import { parseFeedScope } from "../feedScope";
import { renderWithTheme } from "@/test/renderWithTheme";

jest.mock("expo-haptics", () => ({
  selectionAsync: jest.fn().mockResolvedValue(undefined),
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: "light" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}));

jest.useFakeTimers();

describe("FeedScopeToggle", () => {
  it("renders both lowercase scope tabs", async () => {
    await renderWithTheme(<FeedScopeToggle scope="global" onChange={() => {}} />);
    expect(screen.getByText("global")).toBeOnTheScreen();
    expect(screen.getByText("follows")).toBeOnTheScreen();
  });

  it("marks only the active tab as selected", async () => {
    await renderWithTheme(<FeedScopeToggle scope="follows" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "follows" })).toBeSelected();
    expect(screen.getByRole("button", { name: "global" })).not.toBeSelected();
  });

  it("fires onChange with a selection haptic when the inactive tab is pressed", async () => {
    const haptics = jest.requireMock("expo-haptics") as { selectionAsync: jest.Mock };
    const user = userEvent.setup();
    const onChange = jest.fn();
    await renderWithTheme(<FeedScopeToggle scope="global" onChange={onChange} />);

    await user.press(screen.getByRole("button", { name: "follows" }));
    expect(onChange).toHaveBeenCalledWith("follows");
    expect(haptics.selectionAsync).toHaveBeenCalled();
  });

  it("does nothing when the active tab is re-pressed", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    await renderWithTheme(<FeedScopeToggle scope="global" onChange={onChange} />);

    await user.press(screen.getByRole("button", { name: "global" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("parseFeedScope", () => {
  it("accepts the two known scopes", () => {
    expect(parseFeedScope("global")).toBe("global");
    expect(parseFeedScope("follows")).toBe("follows");
  });

  it("collapses anything else to null", () => {
    expect(parseFeedScope("everything")).toBeNull();
    expect(parseFeedScope("")).toBeNull();
    expect(parseFeedScope(null)).toBeNull();
    expect(parseFeedScope(undefined)).toBeNull();
  });
});
