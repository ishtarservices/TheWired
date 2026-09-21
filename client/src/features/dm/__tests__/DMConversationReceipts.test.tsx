import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { StrictMode } from "react";
import { createTestStore } from "@/__tests__/helpers/createTestStore";
import { lunaVega, riverChen } from "@/__tests__/fixtures/testUsers";
import { login } from "@/store/slices/identitySlice";
import { dmSlice } from "@/store/slices/dmSlice";

// One deferred promise per sendReceipt call so the test controls when it resolves.
const receiptResolvers: Array<(sent: boolean) => void> = [];
const sendReceipt = vi.fn(
  (_conv: string, _status: string, _ids: string[]) =>
    new Promise<boolean>((resolve) => {
      receiptResolvers.push(resolve);
    }),
);
vi.mock("../dmService", () => ({
  sendDM: vi.fn(),
  sendDMFile: vi.fn(),
  editDM: vi.fn(),
  deleteDMForEveryone: vi.fn(),
  reactToDM: vi.fn(),
  removeDMReaction: vi.fn(),
  sendTyping: vi.fn(),
  sendReceipt: (c: string, s: string, ids: string[]) => sendReceipt(c, s, ids),
}));
vi.mock("../../calling/useCall", () => ({ useCall: () => ({ startCall: vi.fn(), isInCall: false }) }));
vi.mock("../../wallet/WalletProvider", () => ({ useZap: () => ({ openZap: vi.fn() }) }));
vi.mock("../../profile/useProfile", () => ({ useProfile: () => ({ profile: null }) }));
vi.mock("../useFriends", () => ({ useFriends: () => [riverChen.pubkey] }));
vi.mock("@/hooks/usePlaybackBarSpacing", () => ({
  usePlaybackBarSpacing: () => ({ scrollPaddingClass: "", inputMarginClass: "" }),
}));
vi.mock("@/hooks/useFileUpload", () => ({
  useFileUpload: () => ({
    attachments: [],
    addFiles: vi.fn(),
    removeAttachment: vi.fn(),
    clearAttachments: vi.fn(),
    openFilePicker: vi.fn(),
    handleFileInputChange: vi.fn(),
    fileInputRef: { current: null },
    dropZoneRef: { current: null },
    dragOver: false,
    isUploading: false,
    hasAttachments: false,
  }),
}));
vi.mock("@/features/search/SearchPanel", () => ({ SearchPanel: () => null }));

import { DMConversation } from "../DMConversation";

const ME = lunaVega.pubkey;
const PEER = riverChen.pubkey;
const RUMOR_A = "a".repeat(64);
const RUMOR_B = "b".repeat(64);

function addIncoming(store: ReturnType<typeof createTestStore>, id: string, rumorId: string, createdAt: number) {
  store.dispatch(
    dmSlice.actions.addDMMessage({
      partnerPubkey: PEER,
      myPubkey: ME,
      message: { id, senderPubkey: PEER, content: "hi", createdAt, wrapId: "w-" + id, rumorId },
    }),
  );
}

beforeEach(() => {
  sendReceipt.mockClear();
  receiptResolvers.length = 0;
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  // jsdom has no layout; the unread-divider scroll is irrelevant here.
  Element.prototype.scrollIntoView = vi.fn();
});

describe("DMConversation read receipts (docs/DM_WIRE_CONTRACT.md §2 kind 20015)", () => {
  it("sends one receipt per incoming rumor even when the effect re-runs before the publish resolves", async () => {
    const store = createTestStore();
    store.dispatch(login({ pubkey: ME, signerType: "tauri_keystore" }));
    addIncoming(store, "m1", RUMOR_A, 1);
    store.dispatch(dmSlice.actions.setActiveConversation(PEER));

    // StrictMode mounts effects twice in development — the second run must not re-send.
    render(
      <StrictMode>
        <MemoryRouter>
          <Provider store={store}>
            <DMConversation partnerPubkey={PEER} onBack={() => {}} />
          </Provider>
        </MemoryRouter>
      </StrictMode>,
    );
    expect(sendReceipt).toHaveBeenCalledTimes(1);
    expect(sendReceipt.mock.calls[0][2]).toEqual([RUMOR_A]);

    // A re-render from a store change while the first receipt is still in flight: still nothing new for A.
    await act(async () => {
      addIncoming(store, "m2", RUMOR_B, 2);
    });
    expect(sendReceipt).toHaveBeenCalledTimes(2);
    expect(sendReceipt.mock.calls[1][2]).toEqual([RUMOR_B]);

    await act(async () => {
      receiptResolvers.forEach((r) => r(true));
      await Promise.resolve();
    });
    await act(async () => {
      addIncoming(store, "m3", "c".repeat(64), 3);
    });
    // Only the genuinely new rumor goes out; A and B are already receipted.
    expect(sendReceipt).toHaveBeenCalledTimes(3);
    expect(sendReceipt.mock.calls[2][2]).toEqual(["c".repeat(64)]);
  });

  it("retries a rumor whose receipt was withheld (returned false) on the next effect run", async () => {
    const store = createTestStore();
    store.dispatch(login({ pubkey: ME, signerType: "tauri_keystore" }));
    addIncoming(store, "m1", RUMOR_A, 1);
    store.dispatch(dmSlice.actions.setActiveConversation(PEER));
    render(
      <MemoryRouter>
        <Provider store={store}>
          <DMConversation partnerPubkey={PEER} onBack={() => {}} />
        </Provider>
      </MemoryRouter>,
    );
    expect(sendReceipt).toHaveBeenCalledTimes(1);
    await act(async () => {
      receiptResolvers[0](false);
      await Promise.resolve();
    });
    await act(async () => {
      addIncoming(store, "m2", RUMOR_B, 2);
    });
    expect(sendReceipt).toHaveBeenCalledTimes(2);
    expect(new Set(sendReceipt.mock.calls[1][2])).toEqual(new Set([RUMOR_A, RUMOR_B]));
  });
});
