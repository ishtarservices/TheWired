import { AlertTriangle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { KeyBackupStatus } from "@/lib/nostr/tauriSigner";

interface KeyBackupNoticeProps {
  status: KeyBackupStatus;
  /** True once the secret has been revealed in this session (the confirm is only offered then). */
  canConfirm: boolean;
  onConfirm: () => void;
}

/**
 * Explains where the identity key lives and asks the user to confirm a backup.
 * Until they do, the keystore keeps a plaintext fallback file on disk so the
 * key can never be lost; confirming (on a signed build with a verified
 * keychain copy) lets the app drop that file.
 */
export function KeyBackupNotice({ status, canConfirm, onConfirm }: KeyBackupNoticeProps) {
  if (status.backedUp) {
    return (
      <p className="flex items-start gap-2 text-xs text-muted" data-testid="key-backup-ok">
        <ShieldCheck size={14} className="mt-0.5 shrink-0 text-green-400" />
        <span>
          Backup confirmed.{" "}
          {status.fallbackPresent
            ? "A local file copy of your key is still kept on this computer because this build cannot rely on the OS keychain alone."
            : "Your key is stored only in the OS keychain."}
        </span>
      </p>
    );
  }

  return (
    <div
      className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3"
      data-testid="key-backup-notice"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-400" />
        <div className="space-y-1">
          <p className="text-xs font-medium text-amber-200">Back up your secret key</p>
          <p className="text-xs text-amber-200/80">
            Until you confirm you have saved it, The Wired keeps a copy of your key in a file on
            this computer as a safety net. Reveal it below, save it somewhere safe, then confirm.
          </p>
        </div>
      </div>
      <Button variant="secondary" size="sm" onClick={onConfirm} disabled={!canConfirm}>
        I&apos;ve saved my key
      </Button>
      {!canConfirm && (
        <p className="text-[11px] text-muted">Reveal the key first to enable this.</p>
      )}
    </div>
  );
}
