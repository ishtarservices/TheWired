import { describe, it, expect, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FacetRow } from "@/features/music/Facets";
import { ActiveFilter, Browse } from "../components/Browse";

function Harness({ defaultOpen, onClear }: { defaultOpen: boolean; onClear?: () => void }) {
  return (
    <Browse
      id="browse-under-test"
      storageKey="test"
      defaultOpen={defaultOpen}
      active={<ActiveFilter label="Club" onClear={onClear ?? (() => {})} />}
    >
      <FacetRow label="Scene">
        <button type="button">Vapor</button>
      </FacetRow>
    </Browse>
  );
}

describe("Browse", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts in the state the tab asks for", () => {
    const { unmount } = render(<Harness defaultOpen />);
    expect(screen.getByRole("button", { name: "Browse" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Vapor" })).toBeInTheDocument();
    unmount();

    render(<Harness defaultOpen={false} />);
    expect(screen.getByRole("button", { name: "Browse" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Vapor" })).not.toBeInTheDocument();
  });

  it("remembers the last choice over the default", () => {
    const { unmount } = render(<Harness defaultOpen />);
    fireEvent.click(screen.getByRole("button", { name: "Browse" }));
    expect(screen.queryByRole("button", { name: "Vapor" })).not.toBeInTheDocument();
    unmount();

    render(<Harness defaultOpen />);
    expect(screen.getByRole("button", { name: "Browse" })).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps the filter in use on the page while folded, with a way to clear it", () => {
    let cleared = 0;
    render(<Harness defaultOpen={false} onClear={() => cleared++} />);
    expect(screen.getByText("Club")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove Club filter" }));
    expect(cleared).toBe(1);

    // Open: the pressed option inside the list says it instead.
    fireEvent.click(screen.getByRole("button", { name: "Browse" }));
    expect(screen.queryByText("Club")).not.toBeInTheDocument();
  });
});
