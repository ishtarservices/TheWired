import { useId } from "react";
import type { ChannelTree } from "./channelTree";
import { MAX_CATEGORY_NAME_LENGTH, validateCategoryName } from "./channelTree";

/** What the picker resolved to: no subfolder, an existing one, or a new one to create. */
export type CategoryChoice =
  | { kind: "none" }
  | { kind: "existing"; id: string }
  | { kind: "new"; name: string };

const NEW = "__new__";
const NONE = "__none__";

export function choiceForCategory(categoryId: string | null | undefined): CategoryChoice {
  return categoryId ? { kind: "existing", id: categoryId } : { kind: "none" };
}

/** A validation message for the current choice, or null when it's usable. */
export function categoryChoiceError(choice: CategoryChoice, tree: ChannelTree): string | null {
  return choice.kind === "new" ? validateCategoryName(choice.name, tree) : null;
}

interface CategorySelectProps {
  tree: ChannelTree;
  value: CategoryChoice;
  onChange: (next: CategoryChoice) => void;
  /** Offer "New subfolder…" (needs the layout to be manageable). */
  allowCreate: boolean;
  disabled?: boolean;
}

/**
 * Pick a channel's subfolder: none, any existing one (by name, in sidebar
 * order), or a new one named inline. Reuse is the default path — the list is
 * the space's real subfolders, not free text.
 */
export function CategorySelect({ tree, value, onChange, allowCreate, disabled }: CategorySelectProps) {
  const selectId = useId();
  const inputId = useId();
  const selected = value.kind === "existing" ? value.id : value.kind === "new" ? NEW : NONE;
  const error = categoryChoiceError(value, tree);

  return (
    <div className="space-y-2">
      <label htmlFor={selectId} className="mb-1 block text-xs font-medium text-soft">
        Subfolder
      </label>
      <select
        id={selectId}
        value={selected}
        disabled={disabled}
        onChange={(e) => {
          const v = e.target.value;
          if (v === NONE) onChange({ kind: "none" });
          else if (v === NEW) onChange({ kind: "new", name: "" });
          else onChange({ kind: "existing", id: v });
        }}
        className="w-full rounded-xl bg-field border border-border px-3 py-1.5 text-sm text-heading focus:border-primary focus:outline-none transition-colors disabled:opacity-50"
      >
        <option value={NONE}>No subfolder</option>
        {tree.categories.map((node) => (
          <option key={node.category.id} value={node.category.id}>
            {node.category.name}
          </option>
        ))}
        {allowCreate && <option value={NEW}>+ New subfolder…</option>}
      </select>
      {value.kind === "new" && (
        <div>
          <label htmlFor={inputId} className="sr-only">
            New subfolder name
          </label>
          <input
            id={inputId}
            type="text"
            autoFocus
            value={value.name}
            maxLength={MAX_CATEGORY_NAME_LENGTH}
            onChange={(e) => onChange({ kind: "new", name: e.target.value })}
            placeholder="e.g. Text, Voice, Dev"
            className="w-full rounded-xl bg-field border border-border px-3 py-1.5 text-sm text-heading placeholder-muted focus:border-primary focus:outline-none transition-colors"
          />
          {value.name.trim() && error && <p className="mt-1 text-[11px] text-red-400">{error}</p>}
        </div>
      )}
    </div>
  );
}
