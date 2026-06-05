import { describe, it, expect } from "vitest";
import { useRef, useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PopoverMenu, PopoverMenuItem } from "../PopoverMenu";

function MenuHarness() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={triggerRef} onClick={() => setOpen(true)}>
        trigger
      </button>
      <PopoverMenu open={open} onClose={() => setOpen(false)} anchorRef={triggerRef}>
        <PopoverMenuItem label="one" onClick={() => {}} />
        <PopoverMenuItem label="two" onClick={() => {}} />
        <PopoverMenuItem label="three" onClick={() => {}} />
      </PopoverMenu>
    </>
  );
}

describe("PopoverMenu a11y", () => {
  it("focuses the first item on open", async () => {
    render(
      <PopoverMenu open onClose={() => {}}>
        <PopoverMenuItem label="one" onClick={() => {}} />
        <PopoverMenuItem label="two" onClick={() => {}} />
      </PopoverMenu>,
    );
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText("one")));
  });

  it("roves focus with Arrow keys (wrapping) and Home/End", async () => {
    render(
      <PopoverMenu open onClose={() => {}}>
        <PopoverMenuItem label="one" onClick={() => {}} />
        <PopoverMenuItem label="two" onClick={() => {}} />
        <PopoverMenuItem label="three" onClick={() => {}} />
      </PopoverMenu>,
    );
    const one = screen.getByText("one");
    const two = screen.getByText("two");
    const three = screen.getByText("three");
    await waitFor(() => expect(document.activeElement).toBe(one));

    fireEvent.keyDown(one, { key: "ArrowDown" });
    expect(document.activeElement).toBe(two);

    fireEvent.keyDown(two, { key: "ArrowUp" });
    expect(document.activeElement).toBe(one);

    fireEvent.keyDown(one, { key: "ArrowUp" }); // wraps to last
    expect(document.activeElement).toBe(three);

    fireEvent.keyDown(three, { key: "Home" });
    expect(document.activeElement).toBe(one);

    fireEvent.keyDown(one, { key: "End" });
    expect(document.activeElement).toBe(three);
  });

  it("restores focus to the trigger on close", async () => {
    render(<MenuHarness />);
    const trigger = screen.getByText("trigger");
    trigger.focus();
    fireEvent.click(trigger);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText("one")));
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
