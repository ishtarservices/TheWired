import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SectionHeaderProps {
  title: string;
  /** The line shown when what we asked for is not what we got (sortDisclosure). */
  disclosure?: string | null;
  /** Right-hand slot: a toggle, a chip row, a count. */
  right?: ReactNode;
  className?: string;
}

export function SectionHeader({ title, disclosure, right, className }: SectionHeaderProps) {
  return (
    <div className={cn("mb-3 flex flex-wrap items-center justify-between gap-2", className)}>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-heading">{title}</h2>
        {disclosure && (
          <p className="mt-0.5 font-mono text-[10px] text-faint" data-testid="sort-disclosure">
            {disclosure}
          </p>
        )}
      </div>
      {right}
    </div>
  );
}
