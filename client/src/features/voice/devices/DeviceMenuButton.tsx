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
 * in-call shortcut to Settings › Voice & Video.
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
          "rounded-full transition-colors",
          open ? "bg-card-hover text-heading" : "text-soft hover:bg-card-hover hover:text-heading",
          className,
        )}
        title="Audio & video devices"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Settings size={size} />
      </button>
      <PopoverMenu open={open} onClose={onClose} anchorRef={anchorRef} position="above">
        <div className="w-72 px-3 py-2">
          <DevicePicker compact hideCamera={hideCamera} />
        </div>
      </PopoverMenu>
    </>
  );
}
