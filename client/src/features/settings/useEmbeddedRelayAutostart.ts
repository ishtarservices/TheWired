import { useEffect, useRef } from "react";
import { useAppSelector } from "../../store/hooks";
import {
  embeddedRelaySupported,
  startEmbeddedRelay,
  getEmbeddedRelayStatus,
  startTunnel,
  type TunnelMode,
} from "../../lib/relay/embeddedRelay";
import { reconcileSelfHostedSpaces } from "../spaces/selfHostedReconcile";

const HOST_PREF = "wired_host_relay";
const TUNNEL_PREF = "wired_host_tunnel";
const LAN_PREF = "wired_host_lan";
const CUSTOM_URL_PREF = "wired_host_custom_url";

/** The user's own public relay URL (for the "custom tunnel" mode). */
export function getCustomTunnelUrl(): string {
  try {
    return localStorage.getItem(CUSTOM_URL_PREF) ?? "";
  } catch {
    return "";
  }
}
export function setCustomTunnelUrl(url: string | null): void {
  try {
    if (url) localStorage.setItem(CUSTOM_URL_PREF, url);
    else localStorage.removeItem(CUSTOM_URL_PREF);
  } catch {
    /* ignore */
  }
}

export function getLanPref(): boolean {
  try {
    return localStorage.getItem(LAN_PREF) === "1";
  } catch {
    return false;
  }
}
export function setLanPref(on: boolean): void {
  try {
    if (on) localStorage.setItem(LAN_PREF, "1");
    else localStorage.removeItem(LAN_PREF);
  } catch {
    /* ignore */
  }
}

/** Whether the user opted to host a relay (persisted so it survives restarts). */
export function getHostPref(): boolean {
  try {
    return localStorage.getItem(HOST_PREF) === "1";
  } catch {
    return false;
  }
}
export function setHostPref(on: boolean): void {
  try {
    if (on) localStorage.setItem(HOST_PREF, "1");
    else localStorage.removeItem(HOST_PREF);
  } catch {
    /* ignore */
  }
}
export function getTunnelPref(): TunnelMode | null {
  try {
    const v = localStorage.getItem(TUNNEL_PREF);
    return v === "quick" || v === "named" || v === "custom" ? v : null;
  } catch {
    return null;
  }
}
export function setTunnelPref(mode: TunnelMode | null): void {
  try {
    if (mode) localStorage.setItem(TUNNEL_PREF, mode);
    else localStorage.removeItem(TUNNEL_PREF);
  } catch {
    /* ignore */
  }
}

/**
 * On login (desktop only), bring the embedded relay back up if the user was
 * hosting one, then re-point their self-hosted spaces to its live address — so
 * a space created on the user's own relay keeps working across app restarts
 * without manually re-activating the relay.
 */
export function useEmbeddedRelayAutostart(): void {
  const myPubkey = useAppSelector((s) => s.identity.pubkey);
  const done = useRef(false);

  useEffect(() => {
    if (!myPubkey || !embeddedRelaySupported() || done.current) return;
    done.current = true;
    void (async () => {
      try {
        let status = await getEmbeddedRelayStatus();
        if (!status.running && getHostPref()) {
          status = await startEmbeddedRelay(myPubkey, getLanPref());
          const tunnelMode = getTunnelPref();
          if (tunnelMode) {
            try {
              await startTunnel(
                tunnelMode,
                tunnelMode === "custom" ? getCustomTunnelUrl() : undefined,
              );
            } catch {
              /* tunnel is best-effort */
            }
          }
        }
        if (status.running) reconcileSelfHostedSpaces(status);
      } catch {
        /* best-effort */
      }
    })();
  }, [myPubkey]);
}
