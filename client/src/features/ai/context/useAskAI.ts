/**
 * Hook returning an `askAI(context)` callback for any "Ask AI" affordance. It
 * stages the context and navigates to the AI tab. Passing `null` is a no-op so
 * call sites can forward a builder result directly (builders return null when
 * their source isn't loaded).
 */
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { AIContext } from "@/types/ai";
import { sendToAI } from "./sendToAI";

export function useAskAI(): (context: AIContext | null) => void {
  const navigate = useNavigate();
  return useCallback(
    (context: AIContext | null) => {
      if (!context) return;
      sendToAI(context);
      navigate("/");
    },
    [navigate],
  );
}
