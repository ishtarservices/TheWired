import { store } from "@/store";
import { setPrefs } from "@/store/slices/aiSlice";
import { saveAIPrefs } from "./aiPrefs";

/** Set the provider+model used for new conversations (persisted device-wide). */
export function setDefaultModelPref(providerId: string, model: string): void {
  const next = {
    ...store.getState().ai.prefs,
    defaultProviderId: providerId,
    defaultModel: model,
  };
  store.dispatch(setPrefs(next));
  saveAIPrefs(next);
}
