import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Artwork } from "../Artwork";

describe("Artwork", () => {
  it("renders the cover when there is one", () => {
    render(<Artwork src="https://example.test/cover.jpg" title="concrete psalms" />);
    const img = screen.getByRole("img", { name: "concrete psalms" }) as HTMLImageElement;
    expect(img.tagName).toBe("IMG");
    expect(img.getAttribute("src")).toBe("https://example.test/cover.jpg");
  });

  it("prints the title on a blank sleeve when there is no cover", () => {
    render(<Artwork src={undefined} title="basement two" />);
    expect(screen.queryByRole("img", { name: "basement two" })?.tagName).toBe("DIV");
    expect(screen.getByText("basement two")).toBeTruthy();
  });

  it("falls back to the sleeve when the image fails to load", () => {
    const { container } = render(<Artwork src="https://example.test/dead.jpg" title="b project" />);
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("b project")).toBeTruthy();
  });

  it("retries when the cover URL changes after a failure", () => {
    const { container, rerender } = render(<Artwork src="https://example.test/dead.jpg" title="t" />);
    fireEvent.error(container.querySelector("img")!);
    rerender(<Artwork src="https://example.test/new.jpg" title="t" />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://example.test/new.jpg");
  });

  it("keeps the title off thumbnails too small to hold it", () => {
    render(<Artwork src={null} title="tiny" compact />);
    expect(screen.queryByText("tiny")).toBeNull();
  });
});
