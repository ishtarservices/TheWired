import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { ApiRequestError } from "@/lib/api/client";
import type { Space } from "@/types/space";

const mockRegister = vi.fn();
vi.mock("@/lib/api/spaces", () => ({
  registerSpace: (...a: unknown[]) => mockRegister(...a),
  addFeedSources: vi.fn(async () => ({ data: {} })),
}));

import { store, resetAll } from "@/store";
import { login } from "@/store/slices/identitySlice";
import { CreateSpaceModal } from "../CreateSpaceModal";

const ME = "a".repeat(64);

function renderModal() {
  const onCreate = vi.fn<(space: Space) => void>();
  const onClose = vi.fn();
  render(
    <Provider store={store}>
      <CreateSpaceModal open onClose={onClose} onCreate={onCreate} />
    </Provider>,
  );
  fireEvent.change(screen.getByPlaceholderText("My Space"), { target: { value: "Night Shift" } });
  const create = () => fireEvent.click(screen.getByRole("button", { name: /create space/i }));
  return { onCreate, onClose, create };
}

const sentId = (call: number) => (mockRegister.mock.calls[call][0] as { id: string }).id;

beforeEach(() => {
  store.dispatch(resetAll());
  store.dispatch(login({ pubkey: ME, signerType: "tauri_keystore" }));
  mockRegister.mockReset();
});

describe("CreateSpaceModal (platform)", () => {
  it("creates nothing locally when the backend refuses, and says why", async () => {
    mockRegister.mockRejectedValue(new Error("Failed to fetch"));
    const { onCreate, create } = renderModal();
    create();
    expect((await screen.findByRole("alert")).textContent).toMatch(/couldn't create the space/i);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("retries with the same id, so a slow first success can't make two spaces", async () => {
    mockRegister.mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce({ data: { id: "x" } });
    const { onCreate, create } = renderModal();
    create();
    await screen.findByRole("alert");
    create();
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(sentId(1)).toBe(sentId(0));
    const space = onCreate.mock.calls[0][0];
    expect(space.id).toBe(sentId(0));
    expect(space.listed).toBe(false);
  });

  it("mints a fresh id when the id is taken", async () => {
    mockRegister
      .mockRejectedValueOnce(new ApiRequestError(403, "SPACE_EXISTS", "taken"))
      .mockResolvedValueOnce({ data: { id: "x" } });
    const { onCreate, create } = renderModal();
    create();
    await screen.findByRole("alert");
    create();
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(sentId(1)).not.toBe(sentId(0));
  });
});
