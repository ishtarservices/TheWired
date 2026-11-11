import { useCallback, useState } from "react";
import { useStore } from "react-redux";
import { PhoneOff } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useAppSelector } from "@/store/hooks";
import type { RootState } from "@/store";
import { useProfile } from "@/features/profile/useProfile";
import { cn } from "@/lib/utils";
import { selectActiveMediaSession, type ActiveMediaSession } from "./accountChangeMedia";

/**
 * Asking before an account change ends a call.
 *
 * A call belongs to the account that joined it. Switching accounts, logging
 * out, or adding/removing the active account ends it (see
 * `accountChangeMedia.ts`). That's easy to do by accident from the account
 * menu, and dropping a meeting by surprise is worse than one extra click. So
 * the account actions go through `useEndCallConfirm`, and the add-account
 * forms show `CallDropNotice` next to their inputs. With no call, nothing is
 * asked.
 */

export type AccountChangeIntent = "switch" | "logout" | "add" | "remove";

const COPY: Record<AccountChangeIntent, { title: string; confirm: string; doing: string }> = {
  switch: { title: "Switch accounts?", confirm: "End call & switch", doing: "Switching accounts" },
  logout: { title: "Log out?", confirm: "End call & log out", doing: "Logging out" },
  add: { title: "Add an account?", confirm: "End call & continue", doing: "Adding an account" },
  remove: { title: "Remove this account?", confirm: "End call & remove", doing: "Removing this account" },
};

/** "You're in a video call with Alice." and similar, for the session. */
function useSessionSentence(session: ActiveMediaSession): string {
  const partner = session.kind === "call" ? session.partnerPubkey : null;
  const { profile } = useProfile(partner);
  // No ellipsis on the short key: the sentence adds its own full stop.
  const partnerName = profile?.display_name || profile?.name || (partner ? partner.slice(0, 8) : "");

  const spaceId = session.kind === "voice" ? session.spaceId : null;
  const channelId = session.kind === "voice" ? session.channelId : null;
  const spaceName = useAppSelector((s) =>
    spaceId ? s.spaces.list.find((sp) => sp.id === spaceId)?.name : undefined,
  );
  const channel = useAppSelector((s) =>
    spaceId && channelId ? s.spaces.channels[spaceId]?.find((c) => c.id === channelId) : undefined,
  );

  switch (session.kind) {
    case "call":
      if (session.ringing) return `You're calling ${partnerName}.`;
      return `You're in a ${session.callType === "video" ? "video" : "voice"} call with ${partnerName}.`;
    case "voice": {
      const kind = channel?.type === "video" ? "video channel" : "voice channel";
      const where = channel?.label ? `#${channel.label}` : `a ${kind}`;
      return spaceName ? `You're in ${where} in ${spaceName}.` : `You're in ${where}.`;
    }
    case "voice_connecting":
      return "You're joining a voice channel.";
  }
}

/** Inline warning for forms that change the account on submit. */
export function CallDropNotice({
  session,
  intent,
  className,
}: {
  session: ActiveMediaSession;
  intent: AccountChangeIntent;
  className?: string;
}) {
  const sentence = useSessionSentence(session);
  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400",
        className,
      )}
    >
      <PhoneOff size={14} className="mt-px shrink-0" />
      <span>
        {sentence} {COPY[intent].doing} ends the call.
      </span>
    </div>
  );
}

interface PendingChange {
  intent: AccountChangeIntent;
  session: ActiveMediaSession;
  run: () => void | Promise<void>;
}

function EndCallConfirmDialog({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: PendingChange;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const sentence = useSessionSentence(pending.session);
  const copy = COPY[pending.intent];
  return (
    <Modal open onClose={onCancel}>
      <div
        className="w-full max-w-sm rounded-2xl border-gradient card-glass p-6"
        data-testid="end-call-confirm"
      >
        <div className="mb-3 flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-red-400">
            <PhoneOff size={18} />
          </div>
          <h2 className="text-lg font-bold text-heading">{copy.title}</h2>
        </div>
        <p className="text-sm text-soft">{sentence}</p>
        <p className="mt-2 text-sm text-muted">
          {copy.doing} ends the call. Calls stay with the account that joined them, so it can't
          carry over.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} autoFocus>
            Stay in call
          </Button>
          <Button onClick={onConfirm} className="bg-red-500 text-white hover:bg-red-600 hover:brightness-100">
            {copy.confirm}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * `confirmIfInCall(intent, run)` runs `run` straight away when there is no
 * call. Otherwise it asks first, and `run` only happens on "End call & …".
 * Render `dialog` once in the component.
 */
export function useEndCallConfirm() {
  const store = useStore();
  const [pending, setPending] = useState<PendingChange | null>(null);

  const confirmIfInCall = useCallback(
    (intent: AccountChangeIntent, run: () => void | Promise<void>) => {
      // Read at click time, not render time: the call may have just ended.
      const session = selectActiveMediaSession(store.getState() as RootState);
      if (!session) {
        void run();
        return;
      }
      setPending({ intent, session, run });
    },
    [store],
  );

  const cancel = useCallback(() => setPending(null), []);
  const confirm = useCallback(() => {
    setPending(null);
    if (pending) void pending.run();
  }, [pending]);

  const dialog = pending ? (
    <EndCallConfirmDialog pending={pending} onCancel={cancel} onConfirm={confirm} />
  ) : null;

  return { confirmIfInCall, dialog };
}
