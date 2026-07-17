import { fireEvent, render, screen } from "@testing-library/react-native";

import { Avatar } from "../Avatar";

describe("Avatar", () => {
  it("shows the uppercased first character of the name as fallback", async () => {
    await render(<Avatar name="alice" pubkey="abc123" />);
    expect(screen.getByText("A")).toBeTruthy();
  });

  it("falls back to the pubkey when there is no name", async () => {
    await render(<Avatar pubkey="deadbeef" />);
    expect(screen.getByText("D")).toBeTruthy();
  });

  it("renders a ? when nothing identifies the user", async () => {
    await render(<Avatar />);
    expect(screen.getByText("?")).toBeTruthy();
  });

  it("renders an image instead of the fallback when a uri is given", async () => {
    await render(<Avatar uri="https://example.com/a.png" name="alice" />);
    expect(screen.queryByText("A")).toBeNull();
  });

  it("falls back to the initial circle when the bitmap fails (no stuck grey)", async () => {
    await render(<Avatar uri="https://example.com/dead.png" name="alice" />);
    await fireEvent(screen.getByTestId("avatar-image"), "error");
    expect(screen.getByText("A")).toBeTruthy();
  });

  it("retries a NEW picture url after a previous one failed", async () => {
    const view = await render(<Avatar uri="https://example.com/dead.png" name="alice" />);
    await fireEvent(screen.getByTestId("avatar-image"), "error");
    expect(screen.getByText("A")).toBeTruthy();
    // kind-0 refresh delivers a different picture — the failure resets.
    await view.rerender(<Avatar uri="https://example.com/fresh.png" name="alice" />);
    expect(screen.queryByText("A")).toBeNull();
    expect(screen.getByTestId("avatar-image")).toBeTruthy();
  });

  it("renders the initial fallback for non-http(s) uris (sanitizer)", async () => {
    await render(<Avatar uri="ipfs://nope" name="bob" />);
    expect(screen.getByText("B")).toBeTruthy();
  });
});
