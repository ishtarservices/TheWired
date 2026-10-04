import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { screen, act } from "@testing-library/react";
import { renderWithProviders } from "@/__tests__/helpers/renderWithProviders";
import { login } from "@/store/slices/identitySlice";
import { listenAccessRequested, listenRequestsHydrated } from "@/store/slices/musicSlice";
import { LISTEN_REQUEST_COOLDOWN_SEC } from "../listenRequestWire";

vi.mock("../listenRequests", () => ({
  requestListenAccess: () => async () => {},
  forgetListenAccessRequest: () => async () => {},
  hydrateListenAccessRequests: () => async () => {},
  loadIncomingListenRequests: () => async () => {},
}));

import { RequestAccessButton } from "../RequestAccessButton";

const OWNER = "b".repeat(64);
const ME = "a".repeat(64);
const REF = `31683:${OWNER}:spiral`;

function signIn(store: ReturnType<typeof renderWithProviders>["store"], pubkey: string) {
  act(() => {
    store.dispatch(login({ pubkey, signerType: "nip07" }));
    store.dispatch(listenRequestsHydrated({ pubkey, records: {} }));
  });
}

describe("RequestAccessButton", () => {
  it("renders nothing when signed out or for your own release", () => {
    const { store, container } = renderWithProviders(<RequestAccessButton targetRef={REF} />);
    expect(container).toBeEmptyDOMElement();
    signIn(store, OWNER);
    expect(container).toBeEmptyDOMElement();
  });

  it("offers Request Access, then shows the pending state, then Ask Again after 7 days", () => {
    const { store } = renderWithProviders(<RequestAccessButton targetRef={REF} />);
    signIn(store, ME);
    expect(screen.getByRole("button", { name: /request access/i })).toBeInTheDocument();

    const now = Math.floor(Date.now() / 1000);
    act(() => {
      store.dispatch(listenAccessRequested({ targetRef: REF, record: { requestedAt: now, eventId: "x" } }));
    });
    expect(screen.getByText(/requested, waiting on the artist/i)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    act(() => {
      store.dispatch(
        listenAccessRequested({ targetRef: REF, record: { requestedAt: now - LISTEN_REQUEST_COOLDOWN_SEC, eventId: "x" } }),
      );
    });
    expect(screen.getByRole("button", { name: /ask again/i })).toBeInTheDocument();
  });
});
