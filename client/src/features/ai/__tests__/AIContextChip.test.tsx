import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AIContextChip } from "../context/AIContextChip";

describe("AIContextChip", () => {
  it("shows the content preview with the category as a caption", () => {
    render(<AIContextChip kind="selection" label="Space message" preview="hello there" />);
    expect(screen.getByText("hello there")).not.toBeNull();
    expect(screen.getByText("Space message")).not.toBeNull();
  });

  it("falls back to just the category when there's no preview", () => {
    render(<AIContextChip kind="profile" label="Profile · alice" />);
    expect(screen.getByText("Profile · alice")).not.toBeNull();
  });

  it("renders a working dismiss button only when onDismiss is given", () => {
    const onDismiss = vi.fn();
    const { rerender } = render(
      <AIContextChip kind="note" label="Note" preview="x" onDismiss={onDismiss} />,
    );
    fireEvent.click(screen.getByLabelText("Remove context"));
    expect(onDismiss).toHaveBeenCalledOnce();

    rerender(<AIContextChip kind="note" label="Note" preview="x" />);
    expect(screen.queryByLabelText("Remove context")).toBeNull();
  });
});
