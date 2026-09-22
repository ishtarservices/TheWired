// "Summarize with AI" / "Ask AI" on a DM ships DECRYPTED end-to-end-encrypted
// messages to whichever LLM provider is active. That is a confidentiality
// boundary the feature flag alone does not communicate, so the first use per
// session (per provider) asks. Loopback providers (Ollama / LM Studio on this
// machine) skip the prompt: nothing leaves the device.
//
// The dialog is rendered by <DMAIConsentDialog/> (mounted once in the DM view);
// this module is the promise/state bridge so any menu can request consent.

import { useEffect, useState } from "react";
import { store } from "@/store";

export interface DMAIConsentRequest {
  providerLabel: string;
  resolve: (ok: boolean) => void;
}

const grantedProviders = new Set<string>();
let pending: DMAIConsentRequest | null = null;
const listeners = new Set<(req: DMAIConsentRequest | null) => void>();

function notify(): void {
  for (const l of listeners) l(pending);
}

/** Loopback / private-network base URLs never leave the device. */
export function isLocalProviderUrl(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false;
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host === "[::1]" ||
      host.endsWith(".localhost") ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    );
  } catch {
    return false;
  }
}

/** The provider the AI composer will send to, as the aiSlice knows it. */
function activeProvider(): { id: string; label: string; baseUrl: string } | null {
  const ai = store.getState().ai as {
    providers: Record<string, { id: string; label: string; baseUrl: string }>;
    activeProviderId?: string | null;
    selectedProviderId?: string | null;
    defaultProviderId?: string | null;
  };
  const id = ai.activeProviderId ?? ai.selectedProviderId ?? ai.defaultProviderId ?? null;
  const provider = id ? ai.providers[id] : Object.values(ai.providers)[0];
  return provider ? { id: provider.id, label: provider.label, baseUrl: provider.baseUrl } : null;
}

/**
 * Resolve true when DM plaintext may be sent to the active provider: local
 * providers always, remote ones after the user confirms once this session.
 */
export function ensureDMAIConsent(): Promise<boolean> {
  const provider = activeProvider();
  if (!provider) return Promise.resolve(true); // the composer will complain about no provider itself
  if (isLocalProviderUrl(provider.baseUrl)) return Promise.resolve(true);
  if (grantedProviders.has(provider.id)) return Promise.resolve(true);
  if (pending) return Promise.resolve(false); // one prompt at a time
  return new Promise<boolean>((resolve) => {
    pending = {
      providerLabel: provider.label,
      resolve: (ok) => {
        pending = null;
        if (ok) grantedProviders.add(provider.id);
        notify();
        resolve(ok);
      },
    };
    notify();
  });
}

/** Subscribe to the pending prompt (for the dialog component). */
export function useDMAIConsentRequest(): DMAIConsentRequest | null {
  const [req, setReq] = useState<DMAIConsentRequest | null>(pending);
  useEffect(() => {
    listeners.add(setReq);
    return () => {
      listeners.delete(setReq);
    };
  }, []);
  return req;
}

/** Test hook. */
export function __resetDMAIConsentForTest(): void {
  grantedProviders.clear();
  pending = null;
}
