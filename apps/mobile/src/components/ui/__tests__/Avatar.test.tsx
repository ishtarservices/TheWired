import { render, screen } from "@testing-library/react-native";

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
});
