/**
 * NavigationLogger
 *
 * Drop-in component mounted inside the router. Logs every route change with:
 *  - the new pathname
 *  - the currently logged-in account (so multi-account testing is unambiguous
 *    in shared traces — every nav line carries `acct=<short pubkey>`)
 *  - time since the previous nav (helps spot quick burst-clicks and tabs that
 *    take ages to mount)
 *
 * Pure side-effect; renders nothing.
 */
import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useAppSelector } from "../../store/hooks";
import { createLogger, shortKey } from "./logger";

const log = createLogger("nav");

export function NavigationLogger() {
  const { pathname } = useLocation();
  const myPubkey = useAppSelector((s) => s.identity.pubkey);
  const lastNavAt = useRef<number>(performance.now());
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    if (lastPath.current === pathname) return; // initial mount runs once; later dups are no-ops
    const now = performance.now();
    const sinceLastMs = lastPath.current === null ? null : Math.round(now - lastNavAt.current);
    const from = lastPath.current ?? "(initial)";
    log.info(
      `${from} → ${pathname}  acct=${shortKey(myPubkey)}${sinceLastMs !== null ? `  +${sinceLastMs}ms since last nav` : ""}`,
    );
    lastPath.current = pathname;
    lastNavAt.current = now;
  }, [pathname, myPubkey]);

  return null;
}
