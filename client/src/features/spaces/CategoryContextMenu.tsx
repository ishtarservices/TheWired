import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Plus, Pencil, Trash2, ChevronsDownUp, ChevronsUpDown } from "lucide-react";

interface CategoryContextMenuProps {
  position: { x: number; y: number };
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Management actions (omitted for people who can't manage channels). */
  onNewChannel?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onClose: () => void;
}

const item =
  "flex w-full items-center gap-2 rounded-lg mx-1 px-3.5 py-2.5 text-sm text-body hover:bg-surface-hover hover:text-heading transition-colors";

/** Right-click menu for a subfolder header. */
export function CategoryContextMenu({
  position,
  collapsed,
  onToggleCollapsed,
  onNewChannel,
  onEdit,
  onDelete,
  onClose,
}: CategoryContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [onClose]);

  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="fixed z-50 w-max min-w-[180px] rounded-xl card-glass py-1.5 shadow-xl animate-fade-in-up"
      style={{ left: position.x, top: position.y }}
    >
      <button role="menuitem" onClick={run(onToggleCollapsed)} className={item}>
        {collapsed ? <ChevronsUpDown size={14} /> : <ChevronsDownUp size={14} />}
        {collapsed ? "Expand" : "Collapse"}
      </button>
      {onNewChannel && (
        <button role="menuitem" onClick={run(onNewChannel)} className={item}>
          <Plus size={14} />
          New channel here
        </button>
      )}
      {onEdit && (
        <button role="menuitem" onClick={run(onEdit)} className={item}>
          <Pencil size={14} />
          Edit subfolder
        </button>
      )}
      {onDelete && (
        <button
          role="menuitem"
          onClick={run(onDelete)}
          className="flex w-full items-center gap-2 rounded-lg mx-1 px-3.5 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
        >
          <Trash2 size={14} />
          Delete subfolder
        </button>
      )}
    </div>,
    document.body,
  );
}
