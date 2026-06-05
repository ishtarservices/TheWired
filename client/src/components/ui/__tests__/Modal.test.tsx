import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Modal } from "../Modal";

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>open</button>
      <Modal open={open} onClose={() => setOpen(false)}>
        <div>
          <button>first</button>
          <button>second</button>
        </div>
      </Modal>
    </>
  );
}

describe("Modal a11y", () => {
  it("exposes a dialog role + aria-modal", () => {
    render(
      <Modal open onClose={() => {}}>
        <button>x</button>
      </Modal>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });

  it("moves focus into the dialog on open", async () => {
    render(
      <Modal open onClose={() => {}}>
        <div>
          <button>first</button>
          <button>second</button>
        </div>
      </Modal>,
    );
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText("first")));
  });

  it("traps Tab within the dialog (wraps last → first and first → last)", async () => {
    render(
      <Modal open onClose={() => {}}>
        <div>
          <button>first</button>
          <button>second</button>
        </div>
      </Modal>,
    );
    const dialog = screen.getByRole("dialog");
    const first = screen.getByText("first");
    const last = screen.getByText("second");
    await waitFor(() => expect(document.activeElement).toBe(first));

    last.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("restores focus to the opener on close", async () => {
    render(<Harness />);
    const opener = screen.getByText("open");
    opener.focus();
    fireEvent.click(opener);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText("first")));
    // Esc closes the modal (window keydown handler) → focus returns to the opener.
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});
