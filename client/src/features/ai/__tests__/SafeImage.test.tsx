import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SafeImage } from "../markdown/SafeImage";

describe("SafeImage (click-to-load, EchoLeak mitigation)", () => {
  it("does NOT auto-load a remote image — shows a load button naming the host", () => {
    const { container } = render(<SafeImage src="https://attacker.example/p.png?d=secret" alt="x" />);
    expect(container.querySelector("img")).toBeNull();
    const btn = screen.getByRole("button");
    expect(btn.textContent).toContain("attacker.example");
  });

  it("loads the image only after an explicit click", () => {
    const { container } = render(<SafeImage src="https://cdn.example.com/a.png" alt="pic" />);
    expect(container.querySelector("img")).toBeNull();
    fireEvent.click(screen.getByRole("button"));
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("https://cdn.example.com/a.png");
  });

  it("renders nothing for a disallowed scheme", () => {
    const { container } = render(<SafeImage src="javascript:alert(1)" alt="x" />);
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });
});
