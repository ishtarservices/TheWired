import { useCallback, useEffect, useMemo } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { collapseListenRequests, mutedPubkeys, type ListenRequestGroup } from "./listenRequestInbox";
import { settledAccessSync } from "./listenRequestActions";
import {
  forgetListenAccessRequest,
  hydrateListenAccessRequests,
  loadIncomingListenRequests,
  requestListenAccess,
} from "./listenRequests";
import { canAskAgain, parseListenTarget } from "./listenRequestWire";

/**
 * The owner's open listen requests: fetched on mount and window focus
 * (stale-gated, so several mounted consumers cost one request a minute),
 * collapsed per requester+target, minus muted requesters and requests that
 * need no decision (those are being resolved silently in the background).
 */
export function useIncomingListenRequests(): {
  groups: ListenRequestGroup[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const dispatch = useAppDispatch();
  const me = useAppSelector((s) => s.identity.pubkey);
  const incoming = useAppSelector((s) => s.music.listenRequests.incoming);
  const loading = useAppSelector((s) => s.music.listenRequests.loading);
  const error = useAppSelector((s) => s.music.listenRequests.error);
  const muteList = useAppSelector((s) => s.identity.muteList);

  useEffect(() => {
    if (!me) return;
    void dispatch(loadIncomingListenRequests());
    const onFocus = () => void dispatch(loadIncomingListenRequests());
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [me, dispatch]);

  const groups = useMemo(
    () => collapseListenRequests(incoming, { me, muted: mutedPubkeys(muteList) }),
    [incoming, me, muteList],
  );

  // A string so unrelated store churn doesn't re-render consumers.
  const settledKeys = useAppSelector((s) =>
    groups
      .filter((g) => settledAccessSync(s, g))
      .map((g) => g.key)
      .join("\n"),
  );

  const visible = useMemo(() => {
    if (!settledKeys) return groups;
    const settled = new Set(settledKeys.split("\n"));
    return groups.filter((g) => !settled.has(g.key));
  }, [groups, settledKeys]);

  const refresh = useCallback(() => void dispatch(loadIncomingListenRequests(true)), [dispatch]);

  return { groups: visible, loading, error, refresh };
}

/** Requester side for one target: what they asked, and whether they may ask. */
export function useListenAccessRequest(targetRef: string | null | undefined) {
  const dispatch = useAppDispatch();
  const me = useAppSelector((s) => s.identity.pubkey);
  const hydratedFor = useAppSelector((s) => s.music.listenRequests.requestedFor);
  const record = useAppSelector((s) =>
    targetRef ? s.music.listenRequests.requested[targetRef] : undefined,
  );

  useEffect(() => {
    if (me && hydratedFor !== me) void dispatch(hydrateListenAccessRequests());
  }, [me, hydratedFor, dispatch]);

  const target = targetRef ? parseListenTarget(targetRef) : null;
  const canRequest = !!me && !!target && target.ownerPubkey !== me;

  const request = useCallback(async () => {
    if (!targetRef) return;
    await dispatch(requestListenAccess(targetRef));
  }, [dispatch, targetRef]);

  const askAgain = useCallback(async () => {
    if (!targetRef) return;
    await dispatch(forgetListenAccessRequest(targetRef));
    await dispatch(requestListenAccess(targetRef));
  }, [dispatch, targetRef]);

  return {
    record,
    canRequest,
    mayAskAgain: !!record && canAskAgain(record.requestedAt),
    request,
    askAgain,
  };
}
