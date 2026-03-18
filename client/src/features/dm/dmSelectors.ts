import { createSelector } from "@reduxjs/toolkit";
import type { RootState } from "@/store";

/** Memoized: pending incoming friend requests (stable reference when unchanged) */
export const selectPendingIncomingRequests = createSelector(
  [(s: RootState) => s.friendRequests.requests],
  (requests) =>
    requests.filter(
      (r) => r.direction === "incoming" && r.status === "pending",
    ),
);
