import { useEffect } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { selectFeatureEnabled, FEATURE_AI } from "@/store/slices/featuresSlice";
import { setPrefs } from "@/store/slices/aiSlice";
import {
  loadProvidersForAccount,
  resetLLMManager,
} from "./engine/llmManager";
import { loadConversationsForAccount } from "./conversationActions";
import { loadAIPrefs } from "./aiPrefs";
import { loadWebSearchKey, resetWebSearch } from "./tools/webSearch";
import { abortAllTurns } from "./engine/streamRunner";

/**
 * Effect-only root: loads the active account's AI providers (from the keychain)
 * and conversations (from IndexedDB) when the AI feature is enabled, and tears
 * the provider clients down on logout. Mirrors `WalletProvider`'s login effect.
 */
export function AIProvider() {
  const dispatch = useAppDispatch();
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const aiEnabled = useAppSelector(selectFeatureEnabled(FEATURE_AI));

  useEffect(() => {
    dispatch(setPrefs(loadAIPrefs()));
  }, [dispatch]);

  useEffect(() => {
    // Any account change (login, logout, switch) must stop in-flight turns first
    // so a late finish can't write the previous account's reply into the new one.
    abortAllTurns();
    if (pubkey && aiEnabled) {
      void loadProvidersForAccount(pubkey);
      void loadConversationsForAccount(pubkey);
      void loadWebSearchKey(pubkey);
    } else if (!pubkey) {
      resetLLMManager();
      resetWebSearch();
    }
  }, [pubkey, aiEnabled]);

  return null;
}
