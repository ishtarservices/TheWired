import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Eye, EyeOff } from "lucide-react";

interface SecretKeyQrProps {
  nsec: string;
}

/**
 * Renders the nsec as an inline SVG QR code for scanning into another device.
 *
 * Security notes:
 * - Inline SVG only: no <img>, no data URL, no canvas, nothing leaves the process.
 * - Bech32 is case-insensitive, so the payload is uppercased to hit the QR
 *   alphanumeric mode (smaller symbol, easier scan). Scanners must lowercase
 *   before nip19 decoding.
 * - Blurred by default; the user must explicitly unblur it. The parent owns the
 *   auto-hide timer and unmounts this component when the secret is cleared.
 * - Lazy-loaded by the parent so qrcode.react stays out of the main bundle.
 */
export function SecretKeyQr({ nsec }: SecretKeyQrProps) {
  const [shown, setShown] = useState(false);

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-pressed={shown}
        aria-label={shown ? "Blur secret key QR code" : "Show secret key QR code"}
        className="relative inline-block select-none overflow-hidden rounded-lg bg-white p-3 transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <QRCodeSVG
          value={nsec.toUpperCase()}
          size={176}
          level="M"
          marginSize={0}
          title="Secret key QR code"
          aria-hidden={!shown}
          className={shown ? "" : "blur-md"}
        />
        {!shown && (
          <span className="absolute inset-0 flex items-center justify-center gap-1.5 text-xs font-medium text-neutral-800">
            <Eye size={14} />
            Click to show
          </span>
        )}
      </button>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          className="inline-flex items-center gap-1.5 text-xs text-soft transition-colors hover:text-heading"
        >
          {shown ? <EyeOff size={12} /> : <Eye size={12} />}
          {shown ? "Blur QR" : "Show QR"}
        </button>
      </div>
      <p className="text-xs text-muted">
        Scan with The Wired on another device to sign in there. Anyone who photographs this
        code has full control of your identity.
      </p>
    </div>
  );
}
