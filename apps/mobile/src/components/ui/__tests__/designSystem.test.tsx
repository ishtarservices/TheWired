import { screen, userEvent } from "@testing-library/react-native";
import { Boxes } from "lucide-react-native";
import { Text } from "react-native";

import { Button } from "../Button";
import { Card } from "../Card";
import { EmptyState } from "../EmptyState";
import { ListRow } from "../ListRow";
import { Pill } from "../Pill";
import { SectionHeader } from "../SectionHeader";
import { SegmentedControl } from "../SegmentedControl";
import { Skeleton, SkeletonCircle, SkeletonText } from "../Skeleton";
import { Type } from "../Type";
import { renderWithTheme } from "@/test/renderWithTheme";

jest.mock("expo-haptics", () => ({
  selectionAsync: jest.fn().mockResolvedValue(undefined),
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: "light" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}));

describe("Type", () => {
  it("renders text with a role-driven style", async () => {
    await renderWithTheme(<Type role="display">The Wired</Type>);
    const node = screen.getByText("The Wired");
    const flat = Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean));
    expect(flat.fontSize).toBe(32);
  });

  it("applies tabular figures when asked", async () => {
    await renderWithTheme(
      <Type role="body" tabular>
        1234
      </Type>,
    );
    const node = screen.getByText("1234");
    const flat = Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean));
    expect(flat.fontVariant).toEqual(["tabular-nums"]);
  });
});

describe("Card", () => {
  it("renders children in a plain view without press handlers", async () => {
    await renderWithTheme(
      <Card>
        <Text>Body</Text>
      </Card>,
    );
    expect(screen.getByText("Body")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("becomes pressable when onPress is provided", async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderWithTheme(
      <Card onPress={onPress}>
        <Text>Tap me</Text>
      </Card>,
    );
    await user.press(screen.getByRole("button"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe("ListRow", () => {
  it("shows title and subtitle", async () => {
    await renderWithTheme(<ListRow title="Settings" subtitle="Theme, relays" />);
    expect(screen.getByText("Settings")).toBeTruthy();
    expect(screen.getByText("Theme, relays")).toBeTruthy();
  });

  it("fires onPress", async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderWithTheme(<ListRow title="Log out" onPress={onPress} />);
    await user.press(screen.getByRole("button"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe("SectionHeader", () => {
  it("renders the label", async () => {
    await renderWithTheme(<SectionHeader label="appearance" />);
    expect(screen.getByText("appearance")).toBeTruthy();
  });
});

describe("EmptyState", () => {
  it("renders icon, sentence and action", async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderWithTheme(
      <EmptyState
        icon={Boxes}
        title="No spaces yet"
        message="Join one to get started."
        action={<Button onPress={onPress}>Browse</Button>}
      />,
    );
    expect(screen.getByText("No spaces yet")).toBeTruthy();
    expect(screen.getByText("Join one to get started.")).toBeTruthy();
    await user.press(screen.getByText("Browse"));
    expect(onPress).toHaveBeenCalled();
  });
});

describe("Pill", () => {
  it("renders its label", async () => {
    await renderWithTheme(<Pill label="device key" tone="primary" />);
    expect(screen.getByText("device key")).toBeTruthy();
  });
});

describe("Skeleton", () => {
  it("renders shape primitives without crashing", async () => {
    await renderWithTheme(
      <>
        <Skeleton className="h-4 w-24" />
        <SkeletonCircle size={40} />
        <SkeletonText lines={2} />
      </>,
    );
  });
});

describe("SegmentedControl", () => {
  it("renders options, marks the selection, and switches on press", async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    await renderWithTheme(
      <SegmentedControl
        options={[
          { value: "chat", label: "chat" },
          { value: "notes", label: "notes" },
        ]}
        value="chat"
        onChange={onChange}
      />,
    );

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(tabs[0].props.accessibilityState.selected).toBe(true);

    await user.press(screen.getByText("notes"));
    expect(onChange).toHaveBeenCalledWith("notes");

    // Pressing the already-selected option is a no-op.
    onChange.mockClear();
    await user.press(screen.getByText("chat"));
    expect(onChange).not.toHaveBeenCalled();
  });
});
