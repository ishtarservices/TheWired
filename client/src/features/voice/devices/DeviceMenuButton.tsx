import { useCallback, useRef, useState } from "react";
import { Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { PopoverMenu } from "@/components/ui/PopoverMenu";
import { DevicePicker } from "./DevicePicker";

interface DeviceMenuButtonProps {
  size?: number;
  className?: string;
  hideCamera?: boolean;
}

/**
 * Gear button that opens the mic/speaker/camera picker in a popover — the
 * in-call shortcut to Settings › Voice & Video, plus the one processing
 * switch worth reaching mid-call ("Let voices overlap").
 */
export function DeviceMenuButton({ size = 18, className, hideCamera }: DeviceMenuButtonProps) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  anchorRef.current = btnRef.current;
  // PopoverMenu closes on any outside mousedown, including one on this
  // button; without this guard the following click would reopen it.
  const closedAt = useRef(0);

  const onClose = useCallback(() => {
    closedAt.current = Date.now();
    setOpen(false);
  }, []);

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => {
          if (Date.now() - closedAt.current < 250) return;
          setOpen((v) => !v);
        }}
        className={cn(
          // Sits in the control bars, so it carries the same resting
          // background as the buttons beside it.
          "rounded-full bg-card-hover transition-colors",
          open ? "text-heading" : "text-soft hover:bg-border-light hover:text-heading",
          className,
        )}
        title="Audio & video devices"
        aria-label="Audio & video devices"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Settings size={size} />
      </button>
      <PopoverMenu open={open} onClose={onClose} anchorRef={anchorRef} position="above">
        {/* Only while open: the picker enumerates devices on mount, which can
            start a capture to read their names. Mounted with the closed
            popover, that ran the moment a call or channel appeared, alongside
            the call's own microphone start. */}
        {open && (
          <div className="w-72 px-3 py-2">
            <DevicePicker compact showOverlap hideCamera={hideCamera} />
          </div>
        )}
      </PopoverMenu>
    </>
  );
}
