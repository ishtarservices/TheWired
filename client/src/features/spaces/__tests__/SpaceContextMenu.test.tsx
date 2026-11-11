import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import type { Space } from "@/types/space";
import { ApiRequestError } from "@/lib/api/client";

const mockLeave = vi.fn();
const mockDeleteApi = vi.fn();
vi.mock("@/lib/api/spaces", () => ({
  leaveSpaceApi: (...a: unknown[]) => mockLeave(...a),
  deleteSpaceApi: (...a: unknown[]) => mockDeleteApi(...a),
}));
const mockDeleteLocal = vi.fn();
vi.mock("@/features/spaces/useSpace", () => ({ useSpace: () => ({ deleteSpace: mockDeleteLocal }) }));
vi.mock("@/features/spaces/usePermissions", () => ({ usePermissions: () => ({ can: () => true }) }));
vi.mock("@/features/ai/context/useAskAI", () => ({ useAskAI: () => vi.fn() }));
vi.mock("@/features/spaces/InviteGenerateModal", () => ({ InviteGenerateModal: () => null }));

import { store, resetAll } from "@/store";
import { login } from "@/store/slices/identitySlice";
import { setSpaces } from "@/store/slices/spacesSlice";
import { SpaceContextMenu } from "../SpaceContextMenu";

const ME = "a".repeat(64);
const OTHER = "b".repeat(64);

const space = (creator: string): Space => ({
  id: "space-1",
  name: "Space",
  hostRelay: "wss://host.example",
  mode: "read-write",
  isPrivate: false,
  adminPubkeys: [creator],
  memberPubkeys: [ME, OTHER],
  feedPubkeys: [],
  creatorPubkey: creator,
  createdAt: 0,
  spaceType: "platform",
});

function renderMenu(creator = OTHER) {
  store.dispatch(setSpaces([space(creator)]));
  const onClose = vi.fn();
  render(
    <Provider store={store}>
      <SpaceContextMenu open onClose={onClose} spaceId="space-1" position={{ x: 0, y: 0 }} />
    </Provider>,
  );
  return { onClose };
}

beforeEach(() => {
  store.dispatch(resetAll());
  store.dispatch(login({ pubkey: ME, signerType: "tauri_keystore" }));
  mockLeave.mockReset();
  mockDeleteApi.mockReset();
  mockDeleteLocal.mockReset();
});

describe("SpaceContextMenu leave", () => {
  it("asks before leaving and leaves only on confirm", async () => {
    mockLeave.mockResolvedValue({ data: { left: true } });
    const { onClose } = renderMenu();
    fireEvent.click(screen.getByRole("button", { name: /leave space/i }));
    expect(mockLeave).not.toHaveBeenCalled();
    expect(screen.getByText(/leave this space\?/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /yes, leave/i }));
    await waitFor(() => expect(mockDeleteLocal).toHaveBeenCalledWith("space-1"));
    expect(mockLeave).toHaveBeenCalledWith("space-1");
    expect(onClose).toHaveBeenCalled();
  });

  it("tells the creator the other admins take over", () => {
    renderMenu(ME);
    fireEvent.click(screen.getByRole("button", { name: /leave space/i }));
    expect(screen.getByText(/you created this space/i)).toBeTruthy();
  });

  it("keeps the space and explains when the last admin tries to leave", async () => {
    mockLeave.mockRejectedValue(new ApiRequestError(409, "LAST_ADMIN", "only admin"));
    const { onClose } = renderMenu(ME);
    fireEvent.click(screen.getByRole("button", { name: /leave space/i }));
    fireEvent.click(screen.getByRole("button", { name: /yes, leave/i }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/only admin/i);
    expect(alert.textContent).toMatch(/delete the space/i);
    expect(mockDeleteLocal).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps the space when the backend can't be reached", async () => {
    mockLeave.mockRejectedValue(new Error("Failed to fetch"));
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: /leave space/i }));
    fireEvent.click(screen.getByRole("button", { name: /yes, leave/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/couldn't leave/i);
    expect(mockDeleteLocal).not.toHaveBeenCalled();
  });

  it("drops a space the backend no longer has", async () => {
    mockLeave.mockRejectedValue(new ApiRequestError(404, "NOT_FOUND", "gone"));
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: /leave space/i }));
    fireEvent.click(screen.getByRole("button", { name: /yes, leave/i }));
    await waitFor(() => expect(mockDeleteLocal).toHaveBeenCalledWith("space-1"));
  });
});
