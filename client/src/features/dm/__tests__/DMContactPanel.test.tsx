import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { Provider } from "react-redux";
import { createTestStore } from "@/__tests__/helpers/createTestStore";
import { lunaVega, riverChen } from "@/__tests__/fixtures/testUsers";
import { login } from "@/store/slices/identitySlice";
import { dmSlice, isConversationFlagged } from "@/store/slices/dmSlice";

const blockPeer = vi.fn(async (_pubkey: string) => {});
const unblockPeer = vi.fn(async (_pubkey: string) => {});
vi.mock("../dmService", () => ({
  blockPeer: (pubkey: string) => blockPeer(pubkey),
  unblockPeer: (pubkey: string) => unblockPeer(pubkey),
}));
const startCall = vi.fn();
vi.mock("../../calling/useCall", () => ({ useCall: () => ({ startCall, isInCall: false }) }));
vi.mock("../../wallet/WalletProvider", () => ({ useZap: () => ({ openZap: vi.fn() }) }));
vi.mock("../../profile/useProfile", () => ({ useProfile: () => ({ profile: null }) }));

import { DMContactPanel } from "../DMContactPanel";

const ME = lunaVega.pubkey;
const PEER = riverChen.pubkey;

function setup() {
  const store = createTestStore();
  store.dispatch(login({ pubkey: ME, signerType: "tauri_keystore" }));
  store.dispatch(
    dmSlice.actions.addDMMessage({
      partnerPubkey: PEER,
      myPubkey: ME,
      message: { id: "m", senderPubkey: PEER, content: "hi", createdAt: 1, wrapId: "w", rumorId: "r".repeat(64) },
    }),
  );
  store.dispatch(dmSlice.actions.setActiveConversation(PEER));
  render(
    <Provider store={store}>
      <DMContactPanel />
    </Provider>,
  );
  return store;
}

beforeEach(() => {
  blockPeer.mockClear();
  unblockPeer.mockClear();
  startCall.mockClear();
});

describe("DMContactPanel actions (previously stubs)", () => {
  it("Pin / Archive / Mute toggle the conversation flags", () => {
    const store = setup();
    fireEvent.click(screen.getByText("Pin"));
    expect(isConversationFlagged(store.getState().dm.flags, "pinned", PEER)).toBe(true);
    expect(screen.getByText("Unpin")).not.toBeNull();

    fireEvent.click(screen.getByText("Mute"));
    expect(isConversationFlagged(store.getState().dm.flags, "muted", PEER)).toBe(true);
    fireEvent.click(screen.getByText("Unmute"));
    expect(isConversationFlagged(store.getState().dm.flags, "muted", PEER)).toBe(false);

    fireEvent.click(screen.getByText("Archive"));
    expect(isConversationFlagged(store.getState().dm.flags, "archived", PEER)).toBe(true);
  });

  it("Block asks for confirmation, then adds the peer to the mute list", async () => {
    setup();
    fireEvent.click(screen.getByText("Block"));
    expect(blockPeer).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByText("Confirm block"));
    });
    expect(blockPeer).toHaveBeenCalledWith(PEER);
  });

  it("Voice / Video call start a call with the peer", () => {
    setup();
    fireEvent.click(screen.getByText("Voice Call"));
    expect(startCall).toHaveBeenCalledWith(PEER, "audio");
    fireEvent.click(screen.getByText("Video Call"));
    expect(startCall).toHaveBeenCalledWith(PEER, "video");
  });

  it("the disappearing-messages timer is stored per conversation", () => {
    const store = setup();
    fireEvent.click(screen.getByText("1 day"));
    expect(store.getState().dm.flags.expireAfter[PEER]?.s).toBe(86400);
    fireEvent.click(screen.getByText("Off"));
    expect(store.getState().dm.flags.expireAfter[PEER]?.s).toBe(0);
  });
});
