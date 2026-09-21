import { ShieldAlert } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useDMAIConsentRequest } from "./dmConsent";

/** Once-per-session confirmation before decrypted DMs go to a remote LLM. */
export function DMAIConsentDialog() {
  const req = useDMAIConsentRequest();
  if (!req) return null;
  return (
    <Modal open onClose={() => req.resolve(false)}>
      <div className="w-full max-w-sm rounded-2xl card-glass border border-border p-5 shadow-2xl" data-testid="dm-ai-consent">
        <div className="flex items-center gap-2 text-amber-400">
          <ShieldAlert size={18} />
          <h2 className="text-sm font-semibold text-heading">Send decrypted messages to {req.providerLabel}?</h2>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-soft">
          Your DMs are end-to-end encrypted. Using AI on them decrypts the selected messages and sends the text to
          <span className="text-heading"> {req.providerLabel}</span>, which is outside this device. The other person has
          not agreed to that. A local model (Ollama, LM Studio) would keep everything on this machine.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => req.resolve(false)}
            className="rounded-lg px-3 py-1.5 text-xs text-soft hover:bg-surface hover:text-heading"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => req.resolve(true)}
            className="rounded-lg bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/25"
            data-testid="dm-ai-consent-accept"
          >
            Send this session
          </button>
        </div>
      </div>
    </Modal>
  );
}
