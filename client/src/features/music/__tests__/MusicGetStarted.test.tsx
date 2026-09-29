import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/__tests__/helpers/renderWithProviders";
import { login } from "@/store/slices/identitySlice";
import { act } from "@testing-library/react";

vi.mock("../UploadTrackModal", () => ({
  UploadTrackModal: ({ open }: { open: boolean }) => (open ? <div data-testid="upload-modal" /> : null),
}));
vi.mock("../CreateAlbumModal", () => ({
  CreateAlbumModal: ({ open }: { open: boolean }) => (open ? <div data-testid="project-modal" /> : null),
}));

import { MusicGetStarted } from "../MusicGetStarted";

const PK = "e".repeat(64);

describe("MusicGetStarted", () => {
  it("offers only the explore door when signed out", () => {
    const { store } = renderWithProviders(<MusicGetStarted />);
    expect(screen.queryByRole("button", { name: /upload a track/i })).not.toBeInTheDocument();
    expect(screen.getByText(/sign in to upload/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /browse what others/i }));
    expect(store.getState().music.activeView).toBe("explore");
  });

  it("opens the upload and project modals from their doors", () => {
    const { store } = renderWithProviders(<MusicGetStarted />);
    act(() => {
      store.dispatch(login({ pubkey: PK, signerType: "nip07" }));
    });
    expect(screen.queryByTestId("upload-modal")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /upload a track/i }));
    expect(screen.getByTestId("upload-modal")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /start a project/i }));
    expect(screen.getByTestId("project-modal")).toBeInTheDocument();
  });

  it("folds into a banner with the same two actions", () => {
    const { store } = renderWithProviders(<MusicGetStarted variant="banner" />);
    act(() => {
      store.dispatch(login({ pubkey: PK, signerType: "nip07" }));
    });
    expect(screen.getByRole("region", { name: /get started with music/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /start a project/i }));
    expect(screen.getByTestId("project-modal")).toBeInTheDocument();
  });
});
