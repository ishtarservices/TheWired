import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { createTestStore } from "@/__tests__/helpers/createTestStore";
import { lunaVega, riverChen } from "@/__tests__/fixtures/testUsers";
import { login } from "@/store/slices/identitySlice";
import type { DMMessage as DMMessageType } from "@/store/slices/dmSlice";

vi.mock("../../profile/useProfile", () => ({ useProfile: () => ({ profile: null }) }));
vi.mock("../../profile/UserPopoverContext", () => ({ useUserPopover: () => ({ open: vi.fn() }) }));
vi.mock("../DMMessageContextMenu", () => ({ DMMessageContextMenu: () => null }));

import { DMMessage } from "../DMMessage";

const ME = lunaVega.pubkey;
const PEER = riverChen.pubkey;

function renderMsg(message: DMMessageType, isGrouped: boolean) {
  const store = createTestStore();
  store.dispatch(login({ pubkey: ME, signerType: "tauri_keystore" }));
  return render(
    <MemoryRouter>
      <Provider store={store}>
        <DMMessage message={message} partnerPubkey={PEER} isGrouped={isGrouped} />
      </Provider>
    </MemoryRouter>,
  );
}

const base: DMMessageType = {
  id: "m1",
  senderPubkey: ME,
  content: "hello",
  createdAt: 1_700_000_000,
  wrapId: "w1",
  rumorId: "r".repeat(64),
};

describe("DMMessage receipt glyphs (kind 20015 → deliveredTo / readBy)", () => {
  it("shows Delivered, then Read, on an ungrouped own message", () => {
    const { container, rerender } = renderMsg({ ...base, deliveredTo: [PEER] }, false);
    expect(container.querySelector('[data-testid="dm-delivered"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="dm-read"]')).toBeNull();
    rerender(
      <MemoryRouter>
        <Provider store={createTestStoreLoggedIn()}>
          <DMMessage message={{ ...base, deliveredTo: [PEER], readBy: [PEER] }} partnerPubkey={PEER} isGrouped={false} />
        </Provider>
      </MemoryRouter>,
    );
    expect(container.querySelector('[data-testid="dm-read"]')).not.toBeNull();
  });

  it("still renders the glyph when the message is grouped under a previous own message", () => {
    const { container } = renderMsg({ ...base, readBy: [PEER] }, true);
    expect(container.querySelector('[data-testid="dm-read"]')).not.toBeNull();
  });

  it("renders nothing for a grouped own message without receipts, and never for the peer's messages", () => {
    const { container: a } = renderMsg(base, true);
    expect(a.querySelector('[data-testid="dm-read"], [data-testid="dm-delivered"]')).toBeNull();
    const { container: b } = renderMsg({ ...base, senderPubkey: PEER, readBy: [ME] }, false);
    expect(b.querySelector('[data-testid="dm-read"], [data-testid="dm-delivered"]')).toBeNull();
  });
});

function createTestStoreLoggedIn() {
  const store = createTestStore();
  store.dispatch(login({ pubkey: ME, signerType: "tauri_keystore" }));
  return store;
}
