import type { EventSigner } from "@thewired/core";

/**
 * Abstract signer interface — now the core `EventSigner` (one signer contract
 * for desktop + mobile; the NIP-44-capable extension is core's `SignerAdapter`).
 * The desktop name is kept as an alias so nothing churns.
 */
export type NostrSigner = EventSigner;

/** Detect which signer is available */
export async function detectSigner(): Promise<"nip07" | "tauri" | null> {
  // Check for Tauri first (preferred in Tauri app)
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    return "tauri";
  }

  // Check for NIP-07 browser extension
  if (
    typeof window !== "undefined" &&
    "nostr" in window &&
    window.nostr
  ) {
    return "nip07";
  }

  return null;
}

/** Create the appropriate signer */
export async function createSigner(
  type: "nip07" | "tauri",
): Promise<NostrSigner> {
  if (type === "nip07") {
    const { NIP07Signer } = await import("./nip07Signer");
    return new NIP07Signer();
  } else {
    const { TauriSigner } = await import("./tauriSigner");
    return new TauriSigner();
  }
}
