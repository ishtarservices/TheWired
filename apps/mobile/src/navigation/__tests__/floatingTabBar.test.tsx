import { fireEvent, screen, userEvent } from "@testing-library/react-native";
import { BottomTabBarHeightCallbackContext } from "@react-navigation/bottom-tabs";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { render } from "@testing-library/react-native";

import { FloatingTabBar } from "../FloatingTabBar";
import { ThemeProvider } from "@/theme/ThemeContext";

jest.mock("expo-haptics", () => ({
  selectionAsync: jest.fn().mockResolvedValue(undefined),
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: "light" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}));

const TABS = [
  { name: "SpacesTab", title: "Spaces" },
  { name: "MusicTab", title: "Music" },
  { name: "MessagesTab", title: "Messages" },
  { name: "AITab", title: "AI" },
  { name: "YouTab", title: "You" },
];

function makeProps(overrides: { index?: number; defaultPrevented?: boolean } = {}) {
  const routes = TABS.map((t) => ({ key: `${t.name}-key`, name: t.name }));
  const descriptors = Object.fromEntries(
    routes.map((route, i) => [
      route.key,
      { options: { title: TABS[i].title, tabBarIcon: jest.fn(() => null) } },
    ]),
  );
  const navigation = {
    emit: jest.fn(() => ({ defaultPrevented: overrides.defaultPrevented ?? false })),
    dispatch: jest.fn(),
  };
  const props = {
    state: { key: "tab-state", index: overrides.index ?? 0, routes },
    descriptors,
    navigation,
    insets: { top: 59, bottom: 34, left: 0, right: 0 },
  } as unknown as BottomTabBarProps;
  return { props, navigation };
}

function renderBar(props: BottomTabBarProps, onHeight?: (h: number) => void) {
  return render(
    <ThemeProvider>
      <BottomTabBarHeightCallbackContext.Provider value={onHeight}>
        <FloatingTabBar {...props} />
      </BottomTabBarHeightCallbackContext.Provider>
    </ThemeProvider>,
  );
}

describe("FloatingTabBar", () => {
  it("renders one icon-only button per tab, no visible labels", async () => {
    const { props } = makeProps();
    await renderBar(props);
    for (const tab of TABS) {
      expect(screen.getByLabelText(tab.title)).toBeTruthy();
      expect(screen.queryByText(tab.title)).toBeNull();
    }
  });

  it("marks only the active tab as selected", async () => {
    const { props } = makeProps({ index: 2 });
    await renderBar(props);
    for (const [i, tab] of TABS.entries()) {
      expect(screen.getByLabelText(tab.title).props.accessibilityState).toEqual({
        selected: i === 2,
      });
    }
  });

  it("press on an inactive tab emits tabPress then navigates", async () => {
    const user = userEvent.setup();
    const { props, navigation } = makeProps({ index: 0 });
    await renderBar(props);
    await user.press(screen.getByLabelText("Music"));
    expect(navigation.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "tabPress", target: "MusicTab-key" }),
    );
    expect(navigation.dispatch).toHaveBeenCalledTimes(1);
  });

  it("does not navigate when a listener prevents the default", async () => {
    const user = userEvent.setup();
    const { props, navigation } = makeProps({ index: 0, defaultPrevented: true });
    await renderBar(props);
    await user.press(screen.getByLabelText("Music"));
    expect(navigation.emit).toHaveBeenCalled();
    expect(navigation.dispatch).not.toHaveBeenCalled();
  });

  it("press on the focused tab emits but never dispatches its own navigate", async () => {
    const user = userEvent.setup();
    const { props, navigation } = makeProps({ index: 0 });
    await renderBar(props);
    await user.press(screen.getByLabelText("Spaces"));
    expect(navigation.emit).toHaveBeenCalled();
    expect(navigation.dispatch).not.toHaveBeenCalled();
  });

  it("reports its measured height so useScreenInsets clears the pill", async () => {
    const onHeight = jest.fn();
    const { props } = makeProps();
    await renderBar(props, onHeight);
    fireEvent(screen.getByTestId("floating-tab-bar"), "layout", {
      nativeEvent: { layout: { height: 104, width: 390, x: 0, y: 0 } },
    });
    expect(onHeight).toHaveBeenCalledWith(104);
  });
});
