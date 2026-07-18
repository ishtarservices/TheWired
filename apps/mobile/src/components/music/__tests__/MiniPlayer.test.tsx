import { render, screen, userEvent } from "@testing-library/react-native";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";

import { MiniPlayer } from "../MiniPlayer";
import { ThemeProvider } from "@/theme/ThemeContext";
import {
  musicSlice,
  itemsUpserted,
  queueLoaded,
} from "@/store/slices/musicSlice";
import type { MusicItem } from "@/screens/spaces/musicEventParser";
import type { NostrEvent } from "@thewired/shared-types";

const ev: NostrEvent = {
  id: "e",
  pubkey: "p".repeat(64),
  created_at: 1,
  kind: 31683,
  tags: [],
  content: "",
  sig: "",
};

const item: MusicItem = {
  id: "31683:pk:t",
  event: ev,
  kind: "track",
  addressableId: "31683:pk:t",
  title: "Signal Lost",
  artist: "Lain",
  artwork: null,
  audioUrl: "https://x/a.mp3",
  visibility: "public",
  artistPubkeys: [],
};

function storeWith(current?: MusicItem) {
  const store = configureStore({ reducer: { music: musicSlice.reducer } });
  if (current) {
    store.dispatch(itemsUpserted([current]));
    store.dispatch(
      queueLoaded({ queueIds: [current.addressableId], currentId: current.addressableId }),
    );
  }
  return store;
}

async function renderMini(current: MusicItem | undefined, onOpen = jest.fn()) {
  const store = storeWith(current);
  await render(
    <Provider store={store}>
      <ThemeProvider>
        <MiniPlayer onOpen={onOpen} />
      </ThemeProvider>
    </Provider>,
  );
  return { onOpen };
}

describe("MiniPlayer", () => {
  it("renders nothing when no track is loaded", async () => {
    await renderMini(undefined);
    expect(screen.queryByTestId("mini-player")).toBeNull();
  });

  it("shows the current track title, artist and a play control", async () => {
    await renderMini(item);
    expect(screen.getByTestId("mini-player")).toBeTruthy();
    expect(screen.getByText("Signal Lost")).toBeTruthy();
    expect(screen.getByText("Lain")).toBeTruthy();
    // status is "loading" after queueLoaded → not playing → Play affordance.
    expect(screen.getByLabelText("Play")).toBeTruthy();
  });

  it("calls onOpen when the row is pressed", async () => {
    const user = userEvent.setup();
    const { onOpen } = await renderMini(item);
    await user.press(screen.getByTestId("mini-player"));
    expect(onOpen).toHaveBeenCalled();
  });
});
