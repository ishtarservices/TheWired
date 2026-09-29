import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SecretKeyQr } from "../SecretKeyQr";

// Throwaway test vector: nsec for the all-ones secret key (not a real identity).
const NSEC = "nsec1qyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqs2zwhpr";

describe("SecretKeyQr", () => {
  it("renders an inline SVG QR code (no img, no data URL)", () => {
    const { container } = render(<SecretKeyQr nsec={NSEC} />);
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.innerHTML).not.toContain("data:");
  });

  it("never puts the nsec itself into the DOM as text", () => {
    const { container } = render(<SecretKeyQr nsec={NSEC} />);
    expect(container.textContent?.toLowerCase()).not.toContain(NSEC);
  });

  it("starts blurred and unblurs on click, then re-blurs", () => {
    const { container } = render(<SecretKeyQr nsec={NSEC} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("class")).toContain("blur-md");
    expect(screen.getByText("Click to show")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /show secret key qr code/i }));
    expect(svg.getAttribute("class") ?? "").not.toContain("blur-md");
    expect(screen.queryByText("Click to show")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /blur qr/i }));
    expect(svg.getAttribute("class")).toContain("blur-md");
  });
});
