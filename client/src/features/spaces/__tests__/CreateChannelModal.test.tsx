import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/__tests__/helpers/renderWithProviders";
import { buildChannelTree } from "../channelTree";
import type { SpaceChannel, SpaceChannelCategory } from "@/types/space";

const h = vi.hoisted(() => ({
  createChannel: vi.fn(),
  createCategory: vi.fn(),
  native: false,
  layoutManageable: true,
}));

const channels: SpaceChannel[] = [
  { id: "c1", spaceId: "s", type: "chat", label: "#general", categoryId: null, position: 0, isDefault: true, adminOnly: false, slowModeSeconds: 0, feedMode: "all" },
  { id: "n1", spaceId: "s", type: "notes", label: "#notes", categoryId: "Dev", position: 1, isDefault: false, adminOnly: false, slowModeSeconds: 0, feedMode: "all" },
];
const categories: SpaceChannelCategory[] = [
  { id: "Dev", spaceId: "s", name: "Engineering", position: 0 },
  { id: "abc123", spaceId: "s", name: "Voice", position: 1 },
];

vi.mock("../useSpaceChannels", () => ({
  useSpaceChannels: () => ({
    channels,
    tree: buildChannelTree(channels, categories),
    native: h.native,
    layoutManageable: h.layoutManageable,
    createChannel: h.createChannel,
    createCategory: h.createCategory,
  }),
}));

import { CreateChannelModal } from "../CreateChannelModal";

function subfolderSelect(): HTMLSelectElement {
  return screen.getByLabelText("Subfolder") as HTMLSelectElement;
}

beforeEach(() => {
  h.createChannel.mockReset().mockResolvedValue({});
  h.createCategory.mockReset();
  h.native = false;
  h.layoutManageable = true;
});

describe("CreateChannelModal", () => {
  it("lists existing subfolders by name (never by id) and preselects the one it was opened for", () => {
    renderWithProviders(<CreateChannelModal open onClose={() => {}} spaceId="s" defaultCategoryId="abc123" />);
    const options = [...subfolderSelect().options].map((o) => o.textContent);
    expect(options).toEqual(["No subfolder", "Engineering", "Voice", "+ New subfolder…"]);
    expect(subfolderSelect().value).toBe("abc123");
  });

  it("puts the channel in an existing subfolder by id", async () => {
    const onClose = vi.fn();
    renderWithProviders(<CreateChannelModal open onClose={onClose} spaceId="s" />);
    fireEvent.change(screen.getByLabelText(/Channel Name/), { target: { value: "Ops Room" } });
    fireEvent.change(subfolderSelect(), { target: { value: "Dev" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Channel" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(h.createChannel).toHaveBeenCalledWith(
      expect.objectContaining({ type: "chat", label: "#ops-room", categoryId: "Dev" }),
    );
    expect(h.createCategory).not.toHaveBeenCalled();
  });

  it("'New subfolder…' creates the subfolder first, then the channel inside it by the returned id", async () => {
    h.createCategory.mockResolvedValue("new-id");
    const onClose = vi.fn();
    renderWithProviders(<CreateChannelModal open onClose={onClose} spaceId="s" />);
    fireEvent.change(screen.getByLabelText(/Channel Name/), { target: { value: "lobby" } });
    fireEvent.change(subfolderSelect(), { target: { value: "__new__" } });
    fireEvent.change(screen.getByLabelText("New subfolder name"), { target: { value: "  Hangout " } });
    fireEvent.click(screen.getByRole("button", { name: "Create Channel" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(h.createCategory).toHaveBeenCalledWith("  Hangout ");
    expect(h.createChannel).toHaveBeenCalledWith(expect.objectContaining({ categoryId: "new-id" }));
  });

  it("blocks a new subfolder whose name already exists (ignoring case)", () => {
    renderWithProviders(<CreateChannelModal open onClose={() => {}} spaceId="s" />);
    fireEvent.change(screen.getByLabelText(/Channel Name/), { target: { value: "x" } });
    fireEvent.change(subfolderSelect(), { target: { value: "__new__" } });
    fireEvent.change(screen.getByLabelText("New subfolder name"), { target: { value: "engineering" } });
    expect(screen.getByText(/already a subfolder named/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Create Channel" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the create error and stays open", async () => {
    h.createChannel.mockRejectedValue(new Error("A channel of that type with that name already exists"));
    const onClose = vi.fn();
    renderWithProviders(<CreateChannelModal open onClose={onClose} spaceId="s" />);
    fireEvent.change(screen.getByLabelText(/Channel Name/), { target: { value: "general" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Channel" }));
    expect(await screen.findByText(/already exists/)).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("hides backend-only options in relay-only spaces", () => {
    h.native = true;
    renderWithProviders(<CreateChannelModal open onClose={() => {}} spaceId="s" />);
    expect(screen.queryByText("Admin-only channel")).toBeNull();
    expect(screen.queryByLabelText(/Slow Mode/)).toBeNull();
  });

  it("starts fresh every time it opens", () => {
    const { rerender } = renderWithProviders(<CreateChannelModal open onClose={() => {}} spaceId="s" />);
    fireEvent.change(screen.getByLabelText(/Channel Name/), { target: { value: "draft" } });
    rerender(<CreateChannelModal open={false} onClose={() => {}} spaceId="s" />);
    rerender(<CreateChannelModal open onClose={() => {}} spaceId="s" />);
    expect((screen.getByLabelText(/Channel Name/) as HTMLInputElement).value).toBe("");
  });
});
