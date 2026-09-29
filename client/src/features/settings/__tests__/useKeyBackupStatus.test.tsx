import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const backupStatus = vi.fn();
const markBackedUp = vi.fn();
vi.mock("@/lib/nostr/tauriSigner", () => ({
  TauriSigner: { backupStatus: (...a: unknown[]) => backupStatus(...a), markBackedUp: (...a: unknown[]) => markBackedUp(...a) },
}));

import { useKeyBackupStatus } from "../useKeyBackupStatus";

describe("useKeyBackupStatus", () => {
  beforeEach(() => {
    backupStatus.mockReset();
    markBackedUp.mockReset();
  });

  it("does nothing when disabled (web / non-keystore signer)", async () => {
    const { result } = renderHook(() => useKeyBackupStatus(false));
    await act(async () => {
      await result.current.markBackedUp();
    });
    expect(backupStatus).not.toHaveBeenCalled();
    expect(markBackedUp).not.toHaveBeenCalled();
    expect(result.current.status).toBeNull();
  });

  it("loads the status on mount and updates it after confirming", async () => {
    backupStatus.mockResolvedValue({ backedUp: false, fallbackPresent: true, signedRelease: true });
    markBackedUp.mockResolvedValue({ backedUp: true, fallbackPresent: false, signedRelease: true });

    const { result } = renderHook(() => useKeyBackupStatus(true));
    await waitFor(() => expect(result.current.status?.backedUp).toBe(false));

    await act(async () => {
      await result.current.markBackedUp();
    });
    expect(markBackedUp).toHaveBeenCalledTimes(1);
    expect(result.current.status).toEqual({ backedUp: true, fallbackPresent: false, signedRelease: true });
    expect(result.current.error).toBeNull();
  });

  it("surfaces IPC errors instead of throwing", async () => {
    backupStatus.mockRejectedValue(new Error("No active account"));
    const { result } = renderHook(() => useKeyBackupStatus(true));
    await waitFor(() => expect(result.current.error).toBe("No active account"));
    expect(result.current.status).toBeNull();

    backupStatus.mockResolvedValue({ backedUp: false, fallbackPresent: true, signedRelease: false });
    markBackedUp.mockRejectedValue(new Error("keychain locked"));
    await act(async () => {
      await result.current.markBackedUp();
    });
    expect(result.current.error).toBe("keychain locked");
  });
});
