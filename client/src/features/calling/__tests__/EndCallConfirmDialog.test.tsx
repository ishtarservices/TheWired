/**
 * Asking before an account change ends a call. Switching accounts / logging
 * out from the account menu used to give no sign that it would affect the
 * meeting (and it didn't end it — see accountSwitchMidCall.test.ts). Now the
 * call ends, so the user is asked first. With no call, nothing is asked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, act } from "@testing-library/react";

const h = vi.hoisted(() => ({
  switchTo: vi.fn(async (_pk: string) => {}),
  logOut: vi.fn(async () => {}),
  logOutAll: vi.fn(async () => {}),
}));

const A = "a".repeat(64);
const B = "b".repeat(64);
const PEER = "c".repeat(64);
const NAMES: Record<string, string> = { [A]: "Main", [B]: "Second", [PEER]: "Alice" };

vi.mock("@/features/profile/useProfile", () => ({
  useProfile: (pk: string | null) => ({ profile: pk ? { name: NAMES[pk] ?? "?" } : null }),
}));
vi.mock("@/features/identity/useIdentity", () => ({
  useIdentity: () => ({
    pubkey: A,
    profile: { name: "Main" },
    accounts: [
      { pubkey: A, signerType: "nip07", addedAt: 1 },
      { pubkey: B, signerType: "nip07", addedAt: 2 },
    ],
    logOut: h.logOut,
    logOutAll: h.logOutAll,
    switchTo: h.switchTo,
  }),
}));

import { renderWithProviders } from "@/__tests__/helpers/renderWithProviders";
import { setConnectedRoom } from "@/store/slices/voiceSlice";
import { addSpace, setChannels } from "@/store/slices/spacesSlice";
import { startOutgoingCall, setCallState } from "@/store/slices/callSlice";
import type { Space, SpaceChannel } from "@/types/space";
import { useEndCallConfirm, CallDropNotice } from "../EndCallConfirmDialog";
import { selectActiveMediaSession } from "../accountChangeMedia";
import { ProfileCard } from "@/features/identity/ProfileCard";
import { useAppSelector } from "@/store/hooks";

function Harness({ run }: { run: () => void }) {
  const { confirmIfInCall, dialog } = useEndCallConfirm();
  return (
    <>
      <button onClick={() => confirmIfInCall("switch", run)}>do switch</button>
      {dialog}
    </>
  );
}

function NoticeHarness() {
  const session = useAppSelector(selectActiveMediaSession);
  return session ? <CallDropNotice session={session} intent="add" /> : <p>no call</p>;
}

const SPACE = {
  id: "s1",
  hostRelay: "wss://relay.test",
  name: "Night Shift",
  isPrivate: false,
  adminPubkeys: [],
  memberPubkeys: [],
  feedPubkeys: [],
  mode: "read-write",
  creatorPubkey: A,
  createdAt: 0,
} as Space;
const CHANNEL = {
  id: "c1",
  spaceId: "s1",
  type: "video",
  label: "standup",
  position: 0,
  isDefault: false,
  adminOnly: false,
  slowModeSeconds: 0,
} as SpaceChannel;

type Store = ReturnType<typeof renderWithProviders>["store"];

function joinChannel(store: Store) {
  store.dispatch(addSpace(SPACE));
  store.dispatch(setChannels({ spaceId: "s1", channels: [CHANNEL] }));
  store.dispatch(
    setConnectedRoom({ room: { spaceId: "s1", channelId: "c1", roomName: "s1:c1" }, token: "t", serverUrl: "wss://lk" }),
  );
}

beforeEach(() => {
  h.switchTo.mockClear();
  h.logOut.mockClear();
  h.logOutAll.mockClear();
});

describe("useEndCallConfirm", () => {
  it("runs straight away when there is no call", () => {
    const run = vi.fn();
    renderWithProviders(<Harness run={run} />);
    fireEvent.click(screen.getByText("do switch"));
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("end-call-confirm")).toBeNull();
  });

  it("in a video channel: names it, and only runs on 'End call & switch'", () => {
    const run = vi.fn();
    const { store } = renderWithProviders(<Harness run={run} />);
    act(() => joinChannel(store));

    fireEvent.click(screen.getByText("do switch"));
    expect(run).not.toHaveBeenCalled();
    expect(screen.getByText("Switch accounts?")).toBeInTheDocument();
    expect(screen.getByText("You're in #standup in Night Shift.")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Stay in call"));
    expect(run).not.toHaveBeenCalled();
    expect(screen.queryByTestId("end-call-confirm")).toBeNull();

    fireEvent.click(screen.getByText("do switch"));
    fireEvent.click(screen.getByText("End call & switch"));
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("end-call-confirm")).toBeNull();
  });

  it("Escape cancels", () => {
    const run = vi.fn();
    const { store } = renderWithProviders(<Harness run={run} />);
    act(() => joinChannel(store));
    fireEvent.click(screen.getByText("do switch"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("end-call-confirm")).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it("in a 1:1 call: names the partner", () => {
    const { store } = renderWithProviders(<Harness run={vi.fn()} />);
    act(() => {
      store.dispatch(
        startOutgoingCall({ partnerPubkey: PEER, callType: "video", roomId: "r", roomSecretKey: "01".repeat(32), e2ee: true }),
      );
      store.dispatch(setCallState("active"));
    });
    fireEvent.click(screen.getByText("do switch"));
    expect(screen.getByText("You're in a video call with Alice.")).toBeInTheDocument();
  });
});

describe("CallDropNotice (add-account forms)", () => {
  it("warns inline only while a call is running", () => {
    const { store } = renderWithProviders(<NoticeHarness />);
    expect(screen.getByText("no call")).toBeInTheDocument();
    act(() => joinChannel(store));
    expect(screen.getByRole("status")).toHaveTextContent(
      "You're in #standup in Night Shift. Adding an account ends the call.",
    );
  });
});

/** The card's own button (avatar + name) opens the account menu. */
const openAccountMenu = () => fireEvent.click(screen.getAllByRole("button")[0]);

describe("ProfileCard account menu", () => {
  it("switching accounts mid-call asks first; the switch happens only on confirm", () => {
    const { store } = renderWithProviders(<ProfileCard />);
    act(() => joinChannel(store));

    openAccountMenu();
    fireEvent.click(screen.getByText("Second"));
    expect(h.switchTo).not.toHaveBeenCalled();
    expect(screen.getByText("Switch accounts?")).toBeInTheDocument();

    fireEvent.click(screen.getByText("End call & switch"));
    expect(h.switchTo).toHaveBeenCalledWith(B);
  });

  it("log out mid-call asks first; Stay in call keeps it", () => {
    const { store } = renderWithProviders(<ProfileCard />);
    act(() => joinChannel(store));

    openAccountMenu();
    fireEvent.click(screen.getByText("Log Out"));
    expect(screen.getByText("Log out?")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Stay in call"));
    expect(h.logOut).not.toHaveBeenCalled();
  });

  it("without a call, switching is immediate", () => {
    renderWithProviders(<ProfileCard />);
    openAccountMenu();
    fireEvent.click(screen.getByText("Second"));
    expect(h.switchTo).toHaveBeenCalledWith(B);
    expect(screen.queryByTestId("end-call-confirm")).toBeNull();
  });
});
