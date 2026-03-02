import { useAppSelector } from "@/store/hooks";
import type { DMContact } from "@/store/slices/dmSlice";

/** Returns DM contacts sorted by most recent message */
export function useDMContacts(): DMContact[] {
  return useAppSelector((s) => s.dm.contacts);
}

/** Returns total unread DM count */
export function useDMUnreadCount(): number {
  return useAppSelector((s) =>
    s.dm.contacts.reduce((sum, c) => sum + c.unreadCount, 0),
  );
}
