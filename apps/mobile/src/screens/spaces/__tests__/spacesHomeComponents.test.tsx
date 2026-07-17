import { screen, userEvent } from "@testing-library/react-native";

import { ChannelRowRich } from "../components/ChannelRowRich";
import { MusicChannelRow } from "../components/MusicChannelRow";
import { SpaceSwitcher } from "../components/SpaceSwitcher";
import { parseSpaceSelection, serializeSpaceSelection } from "../spacesSelection";
import type { MySpace, SpaceChannel } from "@/lib/api/spaces";
import { renderWithTheme } from "@/test/renderWithTheme";

jest.mock("expo-haptics", () => ({
  selectionAsync: jest.fn().mockResolvedValue(undefined),
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: "light" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}));

const channel = (over: Partial<SpaceChannel> = {}): SpaceChannel => ({
  id: "general",
  type: "chat",
  label: "general",
  isDefault: false,
  categoryId: null,
  position: 0,
  adminOnly: false,
  slowModeSeconds: 0,
  feedMode: "all",
  ...over,
});

const space = (over: Partial<MySpace> = {}): MySpace => ({
  id: "s1",
  name: "Neon Frequencies",
  about: null,
  picture: null,
  hostRelay: null,
  mode: "read-write",
  memberCount: 6,
  ...over,
});

describe("SpaceSwitcher", () => {
  it("renders feed + discover + a labelled circle per joined space", async () => {
    await renderWithTheme(
      <SpaceSwitcher
        spaces={[space(), space({ id: "s2", name: "Techno" })]}
        selection={{ kind: "feed" }}
        onSelectFeed={jest.fn()}
        onSelectSpace={jest.fn()}
        onDiscover={jest.fn()}
      />,
    );
    expect(screen.getByLabelText("Global feed")).toBeTruthy();
    expect(screen.getByLabelText("Discover spaces")).toBeTruthy();
    expect(screen.getByLabelText("Neon Frequencies")).toBeTruthy();
    expect(screen.getByText("techno")).toBeTruthy(); // lowercase meta label
  });

  it("marks the active space selected and fires the callbacks", async () => {
    const user = userEvent.setup();
    const onSelectSpace = jest.fn();
    const onDiscover = jest.fn();
    await renderWithTheme(
      <SpaceSwitcher
        spaces={[space()]}
        selection={{ kind: "space", spaceId: "s1" }}
        onSelectFeed={jest.fn()}
        onSelectSpace={onSelectSpace}
        onDiscover={onDiscover}
      />,
    );
    expect(screen.getByLabelText("Neon Frequencies").props.accessibilityState).toEqual({
      selected: true,
    });
    expect(screen.getByLabelText("Global feed").props.accessibilityState).toEqual({
      selected: false,
    });
    await user.press(screen.getByLabelText("Neon Frequencies"));
    expect(onSelectSpace).toHaveBeenCalledWith("s1");
    await user.press(screen.getByLabelText("Discover spaces"));
    expect(onDiscover).toHaveBeenCalled();
  });
});

describe("ChannelRowRich", () => {
  it("renders preview line, timestamp and unread pill when data exists", async () => {
    const now = Math.floor(Date.now() / 1000);
    await renderWithTheme(
      <ChannelRowRich
        channel={channel()}
        preview={{ lastText: "test", senderName: "Luna Vega", lastEventAt: now - 120 }}
        unreadCount={3}
        onPress={jest.fn()}
      />,
    );
    expect(screen.getByText("Luna Vega: test")).toBeTruthy();
    expect(screen.getByText("2m")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("renders intentionally bare without preview data — no placeholders", async () => {
    await renderWithTheme(<ChannelRowRich channel={channel()} onPress={jest.fn()} />);
    expect(screen.getByText("general")).toBeTruthy();
    expect(screen.queryByText(/:/)).toBeNull();
    expect(screen.queryByText("0")).toBeNull();
  });

  it("caps the unread pill at 99+", async () => {
    await renderWithTheme(
      <ChannelRowRich
        channel={channel()}
        preview={{ lastText: "x", senderName: "a", lastEventAt: 1 }}
        unreadCount={250}
        onPress={jest.fn()}
      />,
    );
    expect(screen.getByText("99+")).toBeTruthy();
  });

  it("fires onLongPress for the quick-actions sheet", async () => {
    const user = userEvent.setup();
    const onLongPress = jest.fn();
    await renderWithTheme(
      <ChannelRowRich channel={channel()} onPress={jest.fn()} onLongPress={onLongPress} />,
    );
    await user.longPress(screen.getByLabelText("#general"), { duration: 400 });
    expect(onLongPress).toHaveBeenCalled();
  });
});

describe("MusicChannelRow", () => {
  const music = channel({ id: "releases", type: "music", label: "releases" });

  it("shows up to 4 thumbnails plus a +N overflow tile", async () => {
    const artworks = Array.from({ length: 6 }, (_, i) => `https://cdn.example/${i}.jpg`);
    await renderWithTheme(
      <MusicChannelRow channel={music} artworks={artworks} onPress={jest.fn()} />,
    );
    expect(screen.getByText("releases")).toBeTruthy();
    expect(screen.getByText("+2")).toBeTruthy();
  });

  it("degrades to the plain row when no artwork is cached", async () => {
    await renderWithTheme(<MusicChannelRow channel={music} artworks={[]} onPress={jest.fn()} />);
    expect(screen.getByText("releases")).toBeTruthy();
    expect(screen.queryByText(/^\+/)).toBeNull();
  });

  it("drops non-https artwork (fail closed)", async () => {
    await renderWithTheme(
      <MusicChannelRow
        channel={music}
        artworks={["http://insecure.example/a.jpg", "javascript:alert(1)"]}
        onPress={jest.fn()}
      />,
    );
    // Both rejected → plain row treatment.
    expect(screen.queryByText(/^\+/)).toBeNull();
  });
});

describe("spacesSelection", () => {
  it("round-trips both selection kinds", () => {
    expect(parseSpaceSelection(serializeSpaceSelection({ kind: "feed" }))).toEqual({
      kind: "feed",
    });
    expect(
      parseSpaceSelection(serializeSpaceSelection({ kind: "space", spaceId: "s1" })),
    ).toEqual({ kind: "space", spaceId: "s1" });
  });

  it("rejects malformed input", () => {
    expect(parseSpaceSelection(null)).toBeNull();
    expect(parseSpaceSelection("")).toBeNull();
    expect(parseSpaceSelection("not json")).toBeNull();
    expect(parseSpaceSelection('{"kind":"space"}')).toBeNull();
    expect(parseSpaceSelection('{"kind":"other"}')).toBeNull();
    expect(parseSpaceSelection('[1,2]')).toBeNull();
  });
});
