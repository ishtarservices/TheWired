import { memo, type ReactNode } from "react";
import { Avatar } from "@/components/ui/Avatar";
import type { PersonRowData } from "../peopleRow";
import { personSignalLabel, verifierFor } from "../peopleRow";
import { SignalLine } from "./SignalLine";

/**
 * One people row. Second line is the handle OR the bio, never both. The
 * verifier domain appears only in mixed (search) results and only when the
 * handle line doesn't already print an @domain. The follow control is passed
 * in so the row itself stays a single button (no nested interactives).
 */
export const PersonRow = memo(function PersonRow({
  person,
  mixed,
  onOpen,
  action,
}: {
  person: PersonRowData;
  /** Search results mix verified and unverified rows. */
  mixed: boolean;
  onOpen: (pubkey: string) => void;
  action?: ReactNode;
}) {
  const secondary = person.handle ?? person.about;
  const verifier = verifierFor(person.nip05, person.handle, mixed);
  const signal = personSignalLabel(person.noteCount);
  return (
    <div className="flex items-center gap-3 border-b border-border-light py-2.5 last:border-b-0">
      <button
        type="button"
        onClick={() => onOpen(person.pubkey)}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <Avatar src={person.picture} alt={person.name} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-sm font-semibold text-heading">{person.name}</span>
            {verifier && (
              <span className="shrink-0 font-mono text-[10px] text-faint" data-testid="verifier">
                {verifier}
              </span>
            )}
          </div>
          {secondary && (
            <p
              className={
                person.handle
                  ? "truncate font-mono text-[11px] text-muted"
                  : "line-clamp-1 text-xs text-soft"
              }
            >
              {secondary}
            </p>
          )}
          <SignalLine label={signal} className="mt-0.5 block" />
        </div>
      </button>
      {action}
    </div>
  );
});
