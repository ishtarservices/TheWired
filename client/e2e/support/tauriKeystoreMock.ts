/**
 * Tauri keystore mock for Playwright.
 *
 * The app signs through Tauri IPC (TauriSigner → window.__TAURI_INTERNALS__.invoke),
 * which doesn't exist in a plain chromium E2E run. This installs an in-page
 * __TAURI_INTERNALS__ stub whose `invoke` is bridged (via page.exposeFunction) to a
 * Node-side keystore that does REAL schnorr signing / NIP-44 with nostr-tools — so
 * login, signing, NIP-44 DMs and multi-account switching all work headless.
 *
 * State lives in the Node closure for the lifetime of the page, so account adds +
 * switches persist across navigations within a test.
 */
import type { Page } from "@playwright/test";
import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools/pure";
import { nip19, nip44 } from "nostr-tools";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

interface KeystoreState {
  keys: Map<string, Uint8Array>; // pubkey hex → secret
  active: string | null;
  secrets: Map<string, string>;
}

function makeHandler(state: KeystoreState) {
  const activeSk = (): Uint8Array => {
    if (!state.active) throw new Error("no active key");
    const sk = state.keys.get(state.active);
    if (!sk) throw new Error("active key missing");
    return sk;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (cmd: string, args: any): Promise<unknown> => {
    switch (cmd) {
      case "keystore_generate_key": {
        const sk = generateSecretKey();
        const pk = getPublicKey(sk);
        state.keys.set(pk, sk);
        state.active = pk;
        return pk;
      }
      case "keystore_import_key": {
        const sk = hexToBytes(args.secretHex);
        const pk = getPublicKey(sk);
        state.keys.set(pk, sk);
        state.active = pk;
        return pk;
      }
      case "keystore_get_public_key":
        return state.active ?? "";
      case "keystore_has_key":
        return state.active != null;
      case "keystore_list_accounts":
        return [...state.keys.keys()];
      case "keystore_switch_account":
        if (state.keys.has(args.pubkey)) state.active = args.pubkey;
        return null;
      case "keystore_clear_active":
        state.active = null;
        return null;
      case "keystore_get_secret_key":
        return bytesToHex(activeSk());
      case "keystore_sign_event": {
        const arr = JSON.parse(args.serializedEvent) as [number, string, number, number, string[][], string];
        const [, , created_at, kind, tags, content] = arr;
        const ev = finalizeEvent({ created_at, kind, tags, content }, activeSk());
        return { id: ev.id, sig: ev.sig };
      }
      case "keystore_nip44_encrypt": {
        const key = nip44.v2.utils.getConversationKey(activeSk(), args.recipientPubkey);
        return nip44.v2.encrypt(args.plaintext, key);
      }
      case "keystore_nip44_decrypt": {
        const key = nip44.v2.utils.getConversationKey(activeSk(), args.senderPubkey);
        return nip44.v2.decrypt(args.ciphertext, key);
      }
      case "keystore_set_secret":
        state.secrets.set(args.key, args.value);
        return null;
      case "keystore_get_secret":
        return state.secrets.get(args.key) ?? null;
      case "keystore_delete_secret":
        state.secrets.delete(args.key);
        return null;
      // Embedded-relay / tunnel commands (features default off) — answer safely.
      case "relay_status":
      case "relay_stats":
      case "tunnel_status":
      case "tunnel_named_identity":
        return null;
      default:
        // Unknown command — don't crash login; surface for debugging.
        // eslint-disable-next-line no-console
        console.warn(`[tauri-mock] unhandled command: ${cmd}`);
        return null;
    }
  };
}

/** Install the Tauri keystore bridge on a page. Call BEFORE page.goto. */
export async function installTauriMock(page: Page): Promise<{ importNsec: () => string }> {
  const state: KeystoreState = { keys: new Map(), active: null, secrets: new Map() };
  const handler = makeHandler(state);

  await page.exposeFunction("__wiredTauriInvoke", handler);
  await page.addInitScript(() => {
    // Minimal Tauri v2 internals surface used by @tauri-apps/api/core.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__TAURI_INTERNALS__ = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      invoke: (cmd: string, args: any) => (window as any).__wiredTauriInvoke(cmd, args ?? {}),
      transformCallback: (cb: unknown) => cb,
      convertFileSrc: (p: string) => p,
      unregisterCallback: () => {},
    };
  });

  // Helper for tests that want a fresh, valid nsec to import.
  return {
    importNsec: () => nip19.nsecEncode(generateSecretKey()),
  };
}
