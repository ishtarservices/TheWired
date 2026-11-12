import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { spacesSlice, setActiveSpace } from "@/store/slices/spacesSlice";
import { uiSlice, setSidebarMode } from "@/store/slices/uiSlice";
import type { Space } from "@/types/space";
import { SpaceTag } from "../SpaceTag";

function makeStore() {
  const store = configureStore({
    reducer: { spaces: spacesSlice.reducer, ui: uiSlice.reducer },
    middleware: (gdm) => gdm({ serializableCheck: false, immutableCheck: false }),
  });
  store.dispatch(
    spacesSlice.actions.setSpaces([{ id: "neon", name: "Neon Frequencies" } as unknown as Space]),
  );
  store.dispatch(setSidebarMode("music"));
  return store;
}

const renderTag = (ui: React.ReactElement, store = makeStore()) => {
  render(<Provider store={store}>{ui}</Provider>);
  return store;
};

describe("SpaceTag", () => {
  it("names the space a space-only release lives in", () => {
    renderTag(<SpaceTag visibility="space" spaceIds={["neon"]} />);
    expect(screen.getByText("Neon Frequencies")).toBeTruthy();
    expect(screen.getByTitle("Only in Neon Frequencies")).toBeTruthy();
  });

  it("says Space when the viewer is not in that space", () => {
    renderTag(<SpaceTag visibility="space" spaceIds={["elsewhere"]} />);
    expect(screen.getByText("Space")).toBeTruthy();
  });

  it("renders nothing for a public release", () => {
    const { container } = render(
      <Provider store={makeStore()}>
        <SpaceTag visibility="public" spaceIds={[]} />
      </Provider>,
    );
    expect(container.textContent).toBe("");
  });

  it("stays off the cards of that space's own shelf", () => {
    const store = makeStore();
    store.dispatch(setSidebarMode("spaces"));
    store.dispatch(setActiveSpace("neon"));
    const { container } = render(
      <Provider store={store}>
        <SpaceTag visibility="space" spaceIds={["neon"]} />
      </Provider>,
    );
    expect(container.textContent).toBe("");
  });
});
