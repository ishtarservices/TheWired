/**
 * Stage an "Ask AI" context and switch the shell into the AI tab. We do NOT
 * create a conversation here — the composer materializes one on first send — so
 * opening "Ask AI" and changing your mind never litters the list with empty
 * chats. The center view is driven by `sidebarMode` while on the index route, so
 * callers (see {@link useAskAI}) navigate to "/" after calling this.
 */
import { store } from "@/store";
import { setSidebarMode } from "@/store/slices/uiSlice";
import { setActiveConversation, setPendingContext } from "@/store/slices/aiSlice";
import type { AIContext } from "@/types/ai";

export function sendToAI(context: AIContext): void {
  store.dispatch(setSidebarMode("ai"));
  store.dispatch(setActiveConversation(null));
  store.dispatch(setPendingContext(context));
}
