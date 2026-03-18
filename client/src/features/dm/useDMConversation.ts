import { useAppSelector } from "@/store/hooks";
import type { DMMessage } from "@/store/slices/dmSlice";

const EMPTY: DMMessage[] = [];

/** Returns messages for a specific conversation, sorted ascending */
export function useDMConversation(partnerPubkey: string): DMMessage[] {
  return useAppSelector((s) => s.dm.messages[partnerPubkey] ?? EMPTY);
}
