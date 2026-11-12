/**
 * What a tile shows while the video is not (yet) a moving picture.
 *
 * pre-fix: as soon as a camera was "on" the tile rendered a bare <video>.
 * Until the first frame decoded — or for as long as a track never arrived,
 * a key was missing, or the SFU had paused the stream — that was a black or
 * frozen box with a name on it. Upright phone video was always cropped to
 * the wide tile.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { Provider } from "react-redux";
import type { Track } from "livekit-client";

const h = vi.hoisted(() => ({
  track: null as unknown,
  profile: { name: "Luna", picture: "https://example.test/luna.png" } as { name?: string; picture?: string } | null,
}));
vi.mock("@/features/profile/useProfile", () => ({ useProfile: () => ({ profile: h.profile }) }));
vi.mock("@/features/voice/useLiveKitTrack", () => ({ useLiveKitTrack: () => h.track }));

import { MediaTile } from "../MediaTile";
import type { MediaTileModel } from "../types";
import { store, resetAll } from "@/store";

const PK = "a".repeat(64);

function tile(over: Partial<MediaTileModel> = {}): MediaTileModel {
  return {
    id: `${PK}:camera`,
    pubkey: PK,
    source: "camera",
    isLocal: false,
    displayName: "luna",
    isSpeaking: false,
    isMuted: false,
    hasVideo: true,
    handRaised: false,
    connectionQuality: "good",
    videoPaused: false,
    ...over,
  };
}

function fakeTrack() {
  return { attach: vi.fn(), detach: vi.fn() } as unknown as Track;
}

const renderTile = (ui: React.ReactElement) => render(<Provider store={store}>{ui}</Provider>);
const video = (c: HTMLElement) => c.querySelector("video") as HTMLVideoElement;

/** Make the element report a decoded frame of the given size. */
function showFrame(el: HTMLVideoElement, width: number, height: number) {
  Object.defineProperty(el, "videoWidth", { configurable: true, get: () => width });
  Object.defineProperty(el, "videoHeight", { configurable: true, get: () => height });
  act(() => {
    el.dispatchEvent(new Event("loadedmetadata"));
  });
}

beforeEach(() => {
  store.dispatch(resetAll());
  h.track = fakeTrack();
  h.profile = { name: "Luna", picture: "https://example.test/luna.png" };
});

describe("MediaTile", () => {
  it("keeps the avatar up until the first frame is on screen", () => {
    const { container } = renderTile(<MediaTile tile={tile()} />);
    // The element is mounted and attached (it has to be, to receive frames)…
    expect((h.track as { attach: ReturnType<typeof vi.fn> }).attach).toHaveBeenCalledWith(video(container));
    // …but the person is still represented by their avatar, not a black box.
    expect(screen.getByAltText("Luna")).toBeInTheDocument();

    showFrame(video(container), 1280, 720);
    expect(screen.queryByAltText("Luna")).toBeNull();
  });

  it("shows the avatar while a camera is on but its track has not arrived", () => {
    h.track = null;
    renderTile(<MediaTile tile={tile()} />);
    expect(screen.getByAltText("Luna")).toBeInTheDocument();
  });

  it("fills the tile with a wide picture and shows an upright one whole", () => {
    const { container } = renderTile(<MediaTile tile={tile()} onSetFit={() => {}} />);
    showFrame(video(container), 1280, 720);
    expect(video(container).className).toContain("object-cover");

    showFrame(video(container), 720, 1280); // a phone held upright
    expect(video(container).className).toContain("object-contain");
  });

  it("an explicit choice wins over the automatic fit, and the button offers the opposite of what is shown", () => {
    const onSetFit = vi.fn();
    const { container } = renderTile(<MediaTile tile={tile()} fit="cover" onSetFit={onSetFit} />);
    showFrame(video(container), 720, 1280);
    expect(video(container).className).toContain("object-cover");
    fireEvent.click(screen.getByRole("button", { name: "Show whole frame" }));
    expect(onSetFit).toHaveBeenCalledWith("contain");
  });

  it("a stream the SFU paused says so instead of freezing on the last frame, and stays attached", () => {
    const { container } = renderTile(<MediaTile tile={tile({ videoPaused: true })} />);
    showFrame(video(container), 1280, 720);
    expect(screen.getByRole("status")).toHaveTextContent(/video paused/i);
    expect(screen.getByAltText("Luna")).toBeInTheDocument();
    // Detaching would stop the SFU ever resuming it.
    expect(video(container)).not.toBeNull();
    expect((h.track as { detach: ReturnType<typeof vi.fn> }).detach).not.toHaveBeenCalled();
  });

  it("badges a poor connection, on others and on yourself", () => {
    const { unmount } = renderTile(<MediaTile tile={tile({ connectionQuality: "poor" })} />);
    expect(screen.getByLabelText("Poor connection")).toBeInTheDocument();
    unmount();
    renderTile(<MediaTile tile={tile({ connectionQuality: "poor", isLocal: true })} />);
    expect(screen.getByLabelText("Your connection is poor")).toBeInTheDocument();
    unmount();
    renderTile(<MediaTile tile={tile()} />);
    expect(screen.queryByLabelText("Poor connection")).toBeNull();
  });

  it("labels your own tile once, whether or not you have a profile name", () => {
    const { unmount } = renderTile(<MediaTile tile={tile({ isLocal: true, hasVideo: false })} />);
    expect(screen.getByText("Luna (You)")).toBeInTheDocument();
    unmount();
  });

  it("someone with no profile name is shown by a short key, not all 64 characters", () => {
    h.profile = null;
    renderTile(<MediaTile tile={tile({ displayName: PK, hasVideo: false })} />);
    expect(screen.getByText("aaaaaaaa…")).toBeInTheDocument();
    expect(screen.queryByText(PK)).toBeNull();
  });

  it("your own tile says You once when you have no profile name", () => {
    h.profile = null;
    renderTile(<MediaTile tile={tile({ isLocal: true, displayName: "You", hasVideo: false })} />);
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.queryByText("You (You)")).toBeNull();
  });

  it("a remote screen share that has not produced a frame shows a screen placeholder, not a black box", () => {
    renderTile(<MediaTile tile={tile({ id: `${PK}:screenshare`, source: "screenshare" })} />);
    expect(screen.queryByAltText("Luna")).toBeNull();
    expect(screen.getByText("Luna's screen")).toBeInTheDocument();
  });
});
