import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { KeyBackupNotice } from "../KeyBackupNotice";

describe("KeyBackupNotice", () => {
  it("asks for a backup and keeps the confirm disabled until the key was revealed", () => {
    const onConfirm = vi.fn();
    render(
      <KeyBackupNotice
        status={{ backedUp: false, fallbackPresent: true, signedRelease: true }}
        canConfirm={false}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByTestId("key-backup-notice")).toBeInTheDocument();
    const btn = screen.getByRole("button", { name: /i've saved my key/i });
    expect(btn).toBeDisabled();
    expect(screen.getByText(/reveal the key first/i)).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("lets the user confirm once the key has been revealed", () => {
    const onConfirm = vi.fn();
    render(
      <KeyBackupNotice
        status={{ backedUp: false, fallbackPresent: true, signedRelease: true }}
        canConfirm
        onConfirm={onConfirm}
      />,
    );
    const btn = screen.getByRole("button", { name: /i've saved my key/i });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("reports keychain-only storage once backed up and the file is gone", () => {
    render(
      <KeyBackupNotice
        status={{ backedUp: true, fallbackPresent: false, signedRelease: true }}
        canConfirm
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByTestId("key-backup-ok")).toHaveTextContent(/only in the OS keychain/i);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("explains a remaining file copy on builds that cannot rely on the keychain", () => {
    render(
      <KeyBackupNotice
        status={{ backedUp: true, fallbackPresent: true, signedRelease: false }}
        canConfirm
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByTestId("key-backup-ok")).toHaveTextContent(/local file copy/i);
  });
});
