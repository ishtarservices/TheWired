import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Provider } from "react-redux";
// The gate helpers (cancel/approve) dispatch to the PRODUCTION store singleton,
// so the rendered card must read from that same store to reflect changes.
import { store } from "@/store";
import { addPendingWrite, removePendingWrite } from "@/store/slices/aiSlice";
import { PendingWriteCard } from "../gate/PendingWriteCard";
import type { PendingWrite } from "@/types/ai";

function seed(over: Partial<PendingWrite> = {}): string {
  const write: PendingWrite = {
    id: "gate-test-1",
    conversationId: "c1",
    messageId: "m1",
    kind: "note",
    summary: "Post a public note",
    content: "gm nostr",
    status: "pending",
    createdAt: 1,
    ...over,
  };
  store.dispatch(addPendingWrite(write));
  return write.id;
}

afterEach(() => {
  store.dispatch(removePendingWrite("gate-test-1"));
});

function renderCard(id: string) {
  return render(
    <Provider store={store}>
      <PendingWriteCard id={id} />
    </Provider>,
  );
}

describe("PendingWriteCard (the human approval gate)", () => {
  it("shows the exact draft (Intent Preview) + Approve/Edit/Cancel", () => {
    const id = seed({ content: "gm nostr fam" });
    renderCard(id);
    expect(screen.getByText("gm nostr fam")).not.toBeNull();
    expect(screen.getByText(/Approve & publish/i)).not.toBeNull();
    expect(screen.getByText(/Edit/i)).not.toBeNull();
    expect(screen.getByText(/Cancel/i)).not.toBeNull();
  });

  it("Cancel marks the write cancelled and stops offering Approve", () => {
    const id = seed();
    renderCard(id);
    fireEvent.click(screen.getByText(/Cancel/i));
    expect(screen.getByText(/Cancelled/i)).not.toBeNull();
    expect(screen.queryByText(/Approve & publish/i)).toBeNull();
    expect(store.getState().ai.pendingWrites[id].status).toBe("cancelled");
  });

  it("Edit reveals an editable textarea seeded with the draft", () => {
    const id = seed({ content: "draft body" });
    renderCard(id);
    fireEvent.click(screen.getByText(/Edit/i));
    const textarea = screen.getByDisplayValue("draft body") as HTMLTextAreaElement;
    expect(textarea.tagName).toBe("TEXTAREA");
  });

  it("renders the DM recipient for a dm write", () => {
    const id = seed({ kind: "dm", recipientLabel: "alice", content: "hi", summary: "DM alice" });
    renderCard(id);
    expect(screen.getByText(/send a DM to alice/i)).not.toBeNull();
  });
});
