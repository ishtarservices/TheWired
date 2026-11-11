import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/__tests__/helpers/renderWithProviders";
import { RichContent } from "../RichContent";

vi.mock("@/features/profile/useProfile", () => ({ useProfile: () => ({ profile: null }) }));

const A = "https://cdn.example.com/a.jpg";
const B = "https://cdn.example.com/b.jpg";

describe("RichContent message layout", () => {
  it("draws the text first and its images below as one grid", () => {
    const { container } = renderWithProviders(
      <RichContent content={`Three from the trip:\n${A}\n${B}`} layout="message" />,
    );
    const text = container.querySelector(".whitespace-pre-wrap") as HTMLElement;
    expect(text.textContent).toBe("Three from the trip:");
    // The text comes before the media.
    const grid = container.querySelector(".grid") as HTMLElement;
    expect(text.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Two images → the grid (tiles are buttons that open the lightbox).
    const tiles = container.querySelectorAll("button img");
    expect([...tiles].map((i) => i.getAttribute("src"))).toEqual([A, B]);
    expect(container.querySelector(".grid")).not.toBeNull();
  });

  it("reserves a single image's box from its imeta dim", () => {
    const event = { tags: [["imeta", `url ${A}`, "m image/jpeg", "dim 1080x1920"]], pubkey: "a".repeat(64) };
    const { container } = renderWithProviders(<RichContent content={A} event={event} layout="message" />);
    const card = container.querySelector("img")?.parentElement as HTMLElement;
    // Portrait: as tall as the chat box allows, width from the shape.
    expect(card.style.width).toBe(`${Math.round(352 * (1080 / 1920))}px`);
    expect(parseFloat(card.style.aspectRatio)).toBeCloseTo(1080 / 1920);
  });

  it("flow layout keeps media in place", () => {
    renderWithProviders(<RichContent content={`hi ${A} there`} />);
    expect(screen.getByText(/there/)).toBeTruthy();
    expect(document.querySelectorAll(".grid")).toHaveLength(0);
  });
});
