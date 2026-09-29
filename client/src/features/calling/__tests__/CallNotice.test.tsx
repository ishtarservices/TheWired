import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Provider } from "react-redux";

const mockSendDM = vi.fn(async () => {});
vi.mock("@/features/dm/dmService", () => ({ sendDM: (...a: unknown[]) => mockSendDM(...(a as [])) }));
vi.mock("@/features/profile/useProfile", () => ({ useProfile: () => ({ profile: { name: "Luna" } }) }));

import { CallNotice, updateNudgeText } from "../CallNotice";
import { store, resetAll } from "@/store";
import { setCallNotice } from "@/store/slices/callSlice";

const PEER = "b".repeat(64);

beforeEach(() => {
  store.dispatch(resetAll());
  mockSendDM.mockClear();
});

describe("CallNotice", () => {
  it("renders nothing without a notice", () => {
    const { container } = render(<Provider store={store}><CallNotice /></Provider>);
    expect(container).toBeEmptyDOMElement();
  });

  it("explains an outdated peer and sends the nudge DM only on click", () => {
    store.dispatch(setCallNotice({ kind: "peer_outdated", pubkey: PEER }));
    render(<Provider store={store}><CallNotice /></Provider>);
    expect(screen.getByText(/Encrypted calls only/)).toBeInTheDocument();
    expect(screen.getByText(/Luna’s app doesn’t support/)).toBeInTheDocument();
    expect(mockSendDM).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Let them know"));
    expect(mockSendDM).toHaveBeenCalledWith(PEER, updateNudgeText());
    expect(store.getState().call.notice).toBeNull();
  });

  it("explains an unsupported device without offering a nudge, and dismisses", () => {
    store.dispatch(setCallNotice({ kind: "unsupported_device", pubkey: PEER }));
    render(<Provider store={store}><CallNotice /></Provider>);
    expect(screen.getByText(/Calls unavailable on this device/)).toBeInTheDocument();
    expect(screen.queryByText("Let them know")).toBeNull();
    fireEvent.click(screen.getByLabelText("Dismiss"));
    expect(store.getState().call.notice).toBeNull();
  });
});
