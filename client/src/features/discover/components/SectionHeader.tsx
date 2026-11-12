import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SectionHeaderProps {
  title: string;
  /** The line shown when what we asked for is not what we got (sortDisclosure). */
  disclosure?: string | null;
  /** Right-hand slot: a sort, a count. */
  right?: ReactNode;
  className?: string;
}

/** A section label in the small mono caps the music section uses, so a page
 *  of sections reads as labelled shelves rather than a stack of headlines. */
export function SectionHeader({ title, disclosure, right, className }: SectionHeaderProps) {
  return (
    <div className={cn("mb-3 flex min-h-7 flex-wrap items-center justify-between gap-x-4 gap-y-1", className)}>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="label-caps">{title}</h2>
        {disclosure && (
          <p className="readout text-[10px] text-faint" data-testid="sort-disclosure">
            {disclosure}
          </p>
        )}
      </div>
      {right}
    </div>
  );
}
