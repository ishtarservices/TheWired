/**
 * Module-singleton owner of every NWC client for the active account. Decoupled from
 * React: dispatches directly to Redux so the auto-load (on login), explicit add/
 * remove (from settings), and pay path (from ZapModal) share one source of truth.
 *
 * Multi-wallet model: storage is a single blob per account (`nwc_wallets_<pubkey>`)
 * holding `[{id, label, uri}]` + `defaultWalletId`. URIs stay in memory + the keychain
 * — never in Redux (which is exposed to devtools). The wallet slice carries only
 * non-secret display data.
 */
import { nanoid } from "nanoid";
import { store } from "../../store";
import {
  addWalletEntry,
  updateWalletEntry,
  removeWalletEntry,
  setDefaultWalletId,
  clearWallets,
} from "../../store/slices/walletSlice";
import {
  getSecret,
  setSecret,
  deleteSecret,
  nwcWalletsKey,
} from "../../lib/nostr/secretStore";
import { NwcClient, parseNwcUri } from "../../lib/lightning/nwcClient";

interface StoredWallet {
  id: string;
  label: string;
  uri: string;
}

interface StoredConfig {
  wallets: StoredWallet[];
  defaultWalletId: string | null;
}

const clients = new Map<string, NwcClient>();
const uris = new Map<string, string>(); // id → URI (kept here, NEVER in Redux)
let activePubkey: string | null = null;

async function loadConfig(pubkey: string): Promise<StoredConfig | null> {
  const raw = await getSecret(nwcWalletsKey(pubkey));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredConfig;
    if (parsed && Array.isArray(parsed.wallets)) return parsed;
  } catch {
    /* corrupt blob */
  }
  return null;
}

async function persistConfig(pubkey: string): Promise<void> {
  const state = store.getState().wallet;
  const wallets: StoredWallet[] = [];
  for (const entry of Object.values(state.wallets)) {
    const uri = uris.get(entry.id);
    if (uri) wallets.push({ id: entry.id, label: entry.label, uri });
  }
  if (wallets.length === 0) {
    await deleteSecret(nwcWalletsKey(pubkey));
    return;
  }
  const cfg: StoredConfig = {
    wallets,
    defaultWalletId: state.defaultWalletId,
  };
  await setSecret(nwcWalletsKey(pubkey), JSON.stringify(cfg));
}

function hostFromRelay(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Wallet-relay drop handler (per wallet). Intentional `client.close()` nulls
 *  `relay.onclose` first in NwcClient, so this only fires on real drops. */
function handleRelayClose(id: string): void {
  const entry = store.getState().wallet.wallets[id];
  if (entry?.status === "connected") {
    store.dispatch(
      updateWalletEntry({
        id,
        patch: {
          status: "error",
          lastError:
            "Wallet relay disconnected. Reconnect, or it will retry on the next request.",
        },
      }),
    );
  }
}

/** Build a client and verify it with a get_balance round-trip. Replaces any
 *  existing client for the same id. */
async function connectAndVerify(id: string, uri: string): Promise<void> {
  store.dispatch(updateWalletEntry({ id, patch: { status: "connecting" } }));
  // Tear down a prior client for this id immediately so concurrent refreshBalance
  // / payInvoice see "not connected" instead of using a stale closed socket.
  clients.get(id)?.close();
  clients.delete(id);

  const client = NwcClient.fromUri(uri, {
    onClose: () => handleRelayClose(id),
  });
  try {
    const { balance } = await client.getBalance();
    clients.set(id, client);
    store.dispatch(
      updateWalletEntry({
        id,
        patch: { status: "connected", balanceMsat: balance },
      }),
    );
    // Push-based balance updates when the wallet advertises notifications.
    void client.startNotifications(() => {
      void refreshBalance(id);
    });
  } catch (e) {
    client.close();
    store.dispatch(
      updateWalletEntry({
        id,
        patch: {
          status: "error",
          lastError: e instanceof Error ? e.message : "Wallet unreachable",
        },
      }),
    );
    throw e;
  }
}

/** Auto-load every stored wallet for the active account (on login / account switch). */
export async function loadWalletsForAccount(pubkey: string): Promise<void> {
  activePubkey = pubkey;
  // Tear down clients from a previous account.
  for (const client of clients.values()) client.close();
  clients.clear();
  uris.clear();
  store.dispatch(clearWallets());

  const cfg = await loadConfig(pubkey);
  if (!cfg || cfg.wallets.length === 0) return;

  for (const stored of cfg.wallets) {
    let parsed;
    try {
      parsed = parseNwcUri(stored.uri);
    } catch {
      continue; // skip malformed entries
    }
    uris.set(stored.id, stored.uri);
    store.dispatch(
      addWalletEntry({
        id: stored.id,
        label: stored.label,
        walletPubkey: parsed.walletPubkey,
        relayUrl: parsed.relayUrl,
        status: "connecting",
        balanceMsat: null,
        lastError: null,
      }),
    );
    // Fire-and-forget per wallet so one slow/offline wallet doesn't block the rest.
    void connectAndVerify(stored.id, stored.uri).catch(() => {
      /* status was already updated to "error" inside connectAndVerify */
    });
  }

  const desiredDefault =
    cfg.defaultWalletId && cfg.wallets.some((w) => w.id === cfg.defaultWalletId)
      ? cfg.defaultWalletId
      : cfg.wallets[0].id;
  store.dispatch(setDefaultWalletId(desiredDefault));
}

/** Connect a new wallet for the active account. Validates by attempting `get_balance`;
 *  rolls back the slice entry if the connect fails. */
export async function addWallet(uri: string, label?: string): Promise<void> {
  if (!activePubkey) throw new Error("Log in before connecting a wallet.");
  const trimmed = uri.trim();
  const parsed = parseNwcUri(trimmed); // throws on malformed
  const id = nanoid(8);
  const finalLabel = (label?.trim() || hostFromRelay(parsed.relayUrl)).slice(0, 60);
  uris.set(id, trimmed);
  store.dispatch(
    addWalletEntry({
      id,
      label: finalLabel,
      walletPubkey: parsed.walletPubkey,
      relayUrl: parsed.relayUrl,
      status: "connecting",
      balanceMsat: null,
      lastError: null,
    }),
  );
  try {
    await connectAndVerify(id, trimmed);
    // First wallet ever → become default automatically.
    if (!store.getState().wallet.defaultWalletId) {
      store.dispatch(setDefaultWalletId(id));
    }
    await persistConfig(activePubkey);
  } catch (e) {
    // Roll back so the failed add doesn't litter the list.
    uris.delete(id);
    store.dispatch(removeWalletEntry(id));
    throw e;
  }
}

/** Remove a wallet entirely (closes the client + drops the URI from storage). */
export async function removeWallet(id: string): Promise<void> {
  clients.get(id)?.close();
  clients.delete(id);
  uris.delete(id);
  store.dispatch(removeWalletEntry(id));
  if (activePubkey) await persistConfig(activePubkey);
}

/** Mark a wallet as the default ZapModal pick. Persists to the stored config. */
export async function setDefaultWallet(id: string): Promise<void> {
  if (!store.getState().wallet.wallets[id]) return;
  store.dispatch(setDefaultWalletId(id));
  if (activePubkey) await persistConfig(activePubkey);
}

/** Retry connecting a specific wallet (e.g. after the relay came back). */
export async function reconnectWallet(id: string): Promise<void> {
  const uri = uris.get(id);
  if (!uri) throw new Error("Wallet not found.");
  await connectAndVerify(id, uri);
}

/** Pull the current balance for one wallet. Surfaces transport errors as offline
 *  status (with auto-recovery on the next successful fetch). */
export async function refreshBalance(id: string): Promise<void> {
  const client = clients.get(id);
  if (!client) return;
  try {
    const { balance } = await client.getBalance();
    store.dispatch(
      updateWalletEntry({
        id,
        patch: { status: "connected", balanceMsat: balance },
      }),
    );
  } catch (e) {
    store.dispatch(
      updateWalletEntry({
        id,
        patch: {
          status: "error",
          lastError:
            e instanceof Error && e.message
              ? e.message
              : "Couldn't reach your wallet.",
        },
      }),
    );
  }
}

/** Pay an invoice from a specific wallet. Transport/timeout failures flip its status;
 *  wallet-level errors (INSUFFICIENT_BALANCE etc.) pass through unchanged. */
export async function payInvoice(
  walletId: string,
  invoice: string,
  amountMsat: number,
): Promise<{ preimage: string; fees_paid?: number }> {
  const client = clients.get(walletId);
  if (!client) throw new Error("Selected wallet isn't connected.");
  try {
    const result = await client.payInvoice(invoice, amountMsat);
    void refreshBalance(walletId);
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("did not respond") || msg.includes("Failed to send")) {
      store.dispatch(
        updateWalletEntry({
          id: walletId,
          patch: { status: "error", lastError: msg },
        }),
      );
    }
    throw e;
  }
}

/** Tear down all clients on logout / no active account. */
export function resetWalletManager(): void {
  for (const client of clients.values()) client.close();
  clients.clear();
  uris.clear();
  activePubkey = null;
}
