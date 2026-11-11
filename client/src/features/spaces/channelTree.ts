import type { SpaceChannel, SpaceChannelCategory } from "../../types/space";

/**
 * Pure channel-tree model for a space's sidebar: uncategorized channels first,
 * then categories (subfolders) in order, each with its channels. This is the
 * canonical order the backend encodes in `position` (docs/CHANNEL_LAYOUT.md),
 * so every surface (sidebar, settings, pickers, mobile) agrees.
 *
 * Tree operations are plain `tree -> tree` functions over ids, so a write that
 * loses a race (409) can be re-applied to the fresh layout unchanged.
 */

export interface CategoryNode {
  category: SpaceChannelCategory;
  channels: SpaceChannel[];
  /** Not in the space's category list (legacy data, categories not loaded yet):
   *  its name is the raw id, exactly what older clients showed. */
  synthetic: boolean;
  /** Created locally and not saved yet; the backend assigns the id. */
  pending?: boolean;
}

export interface ChannelTree {
  uncategorized: SpaceChannel[];
  categories: CategoryNode[];
}

export type TreeOp = (tree: ChannelTree) => ChannelTree;

export class TreeOpError extends Error {}

/** UI limit for new or renamed subfolder names (the server accepts legacy names up to 128). */
export const MAX_CATEGORY_NAME_LENGTH = 50;
export const MAX_CATEGORIES = 50;

// C0/C1 controls, line/paragraph separators, bidi embeddings/overrides/isolates
// (spoofing), zero-width and BOM characters. Mirrors the backend rule.
const FORBIDDEN_NAME_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/;
const UNSAFE_ID_CHARS = /[/?#%\\]/;

/** Drop control/invisible/bidi characters and trim (for untrusted names and labels). */
export function stripInvisible(text: string): string {
  return text.replace(new RegExp(FORBIDDEN_NAME_CHARS.source, "g"), "").trim();
}

function compareChannels(a: SpaceChannel, b: SpaceChannel): number {
  return a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function compareCategories(a: SpaceChannelCategory, b: SpaceChannelCategory): number {
  return a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Group channels into the canonical tree. `categories` undefined means the
 * category list isn't known (older backend, cache without categories): every
 * distinct `categoryId` then becomes a synthetic category in order of first
 * appearance — exactly how the sidebar grouped before categories existed.
 */
export function buildChannelTree(
  channels: readonly SpaceChannel[],
  categories: readonly SpaceChannelCategory[] | undefined,
): ChannelTree {
  const sorted = [...channels].sort(compareChannels);
  const known = [...(categories ?? [])].sort(compareCategories);
  const nodes = new Map<string, CategoryNode>();
  for (const category of known) nodes.set(category.id, { category, channels: [], synthetic: false });

  const uncategorized: SpaceChannel[] = [];
  const synthetic: CategoryNode[] = [];
  for (const ch of sorted) {
    const catId = ch.categoryId;
    if (!catId) {
      uncategorized.push(ch);
      continue;
    }
    let node = nodes.get(catId);
    if (!node) {
      node = {
        category: { id: catId, spaceId: ch.spaceId, name: catId, position: known.length + synthetic.length },
        channels: [],
        synthetic: true,
      };
      nodes.set(catId, node);
      synthetic.push(node);
    }
    node.channels.push(ch);
  }
  return {
    uncategorized,
    categories: [...known.map((c) => nodes.get(c.id)!), ...synthetic],
  };
}

/** Every channel in canonical order. */
export function flattenTree(tree: ChannelTree): SpaceChannel[] {
  return [...tree.uncategorized, ...tree.categories.flatMap((n) => n.channels)];
}

/** Channels + categories with positions rewritten to match the tree (for optimistic state). */
export function treeToState(tree: ChannelTree): { channels: SpaceChannel[]; categories: SpaceChannelCategory[] } {
  let pos = 0;
  const channels: SpaceChannel[] = [];
  for (const ch of tree.uncategorized) channels.push({ ...ch, categoryId: null, position: pos++ });
  const categories: SpaceChannelCategory[] = [];
  tree.categories.forEach((node, i) => {
    categories.push({ ...node.category, position: i });
    for (const ch of node.channels) channels.push({ ...ch, categoryId: node.category.id, position: pos++ });
  });
  return { channels, categories };
}

/** Body for `PUT /spaces/:id/channels/layout`. Pending categories go without an id. */
export function treeToLayoutDoc(tree: ChannelTree, baseRevision: number) {
  return {
    baseRevision,
    uncategorized: tree.uncategorized.map((c) => c.id),
    categories: tree.categories.map((n) => ({
      ...(n.pending ? {} : { id: n.category.id }),
      name: n.category.name,
      channelIds: n.channels.map((c) => c.id),
    })),
  };
}

/** Validate a new or renamed subfolder name. Returns an error message or null. */
export function validateCategoryName(name: string, tree: ChannelTree, exceptId?: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Give the subfolder a name.";
  if (trimmed.length > MAX_CATEGORY_NAME_LENGTH) return `Keep it to ${MAX_CATEGORY_NAME_LENGTH} characters or fewer.`;
  if (FORBIDDEN_NAME_CHARS.test(trimmed)) return "Names can't contain control or invisible characters.";
  const key = trimmed.toLowerCase();
  if (tree.categories.some((n) => n.category.id !== exceptId && n.category.name.trim().toLowerCase() === key)) {
    return `There's already a subfolder named "${trimmed}".`;
  }
  return null;
}

/**
 * A new category id (relay-only spaces assign their own; the backend applies
 * the same rule): the name when it is safe as an opaque key, suffixed on
 * collision, otherwise random.
 */
export function deriveCategoryId(name: string, taken: ReadonlySet<string>, random: () => string): string {
  const safe =
    name.length > 0 &&
    name.length <= 64 &&
    name === name.trim() &&
    name !== "." &&
    name !== ".." &&
    !UNSAFE_ID_CHARS.test(name) &&
    !FORBIDDEN_NAME_CHARS.test(name);
  if (safe) {
    if (!taken.has(name)) return name;
    for (let n = 2; n < 100; n++) {
      const candidate = `${name}~${n}`;
      if (candidate.length <= 64 && !taken.has(candidate)) return candidate;
    }
  }
  let id = random();
  while (taken.has(id)) id = random();
  return id;
}

// ── Operations ──────────────────────────────────────────────────────────

function cloneTree(tree: ChannelTree): ChannelTree {
  return {
    uncategorized: [...tree.uncategorized],
    categories: tree.categories.map((n) => ({ ...n, category: { ...n.category }, channels: [...n.channels] })),
  };
}

function bucket(tree: ChannelTree, categoryId: string | null): SpaceChannel[] {
  if (categoryId === null) return tree.uncategorized;
  const node = tree.categories.find((n) => n.category.id === categoryId);
  if (!node) throw new TreeOpError("That subfolder no longer exists.");
  return node.channels;
}

function clampIndex(index: number, length: number): number {
  if (!Number.isFinite(index)) return length;
  return Math.max(0, Math.min(Math.trunc(index), length));
}

/** Move a channel into `toCategoryId` (null = uncategorized) at `index` within it. */
export function moveChannel(channelId: string, toCategoryId: string | null, index: number): TreeOp {
  return (tree) => {
    const next = cloneTree(tree);
    let moving: SpaceChannel | undefined;
    for (const list of [next.uncategorized, ...next.categories.map((n) => n.channels)]) {
      const i = list.findIndex((c) => c.id === channelId);
      if (i >= 0) {
        moving = list.splice(i, 1)[0];
        break;
      }
    }
    if (!moving) throw new TreeOpError("That channel no longer exists.");
    const target = bucket(next, toCategoryId);
    target.splice(clampIndex(index, target.length), 0, moving);
    return next;
  };
}

/** Move a category to `index` among the categories. */
export function moveCategory(categoryId: string, index: number): TreeOp {
  return (tree) => {
    const next = cloneTree(tree);
    const i = next.categories.findIndex((n) => n.category.id === categoryId);
    if (i < 0) throw new TreeOpError("That subfolder no longer exists.");
    const [node] = next.categories.splice(i, 1);
    next.categories.splice(clampIndex(index, next.categories.length), 0, node);
    return next;
  };
}

/** Append a new category. `id` is a placeholder for REST spaces (`pending`), final for relay-only ones. */
export function addCategory(name: string, id: string, spaceId: string, pending: boolean): TreeOp {
  return (tree) => {
    const error = validateCategoryName(name, tree);
    if (error) throw new TreeOpError(error);
    if (tree.categories.length >= MAX_CATEGORIES) {
      throw new TreeOpError(`A space can have at most ${MAX_CATEGORIES} subfolders.`);
    }
    const next = cloneTree(tree);
    next.categories.push({
      category: { id, spaceId, name: name.trim(), position: next.categories.length },
      channels: [],
      synthetic: false,
      pending,
    });
    return next;
  };
}

export function renameCategory(categoryId: string, name: string): TreeOp {
  return (tree) => {
    const error = validateCategoryName(name, tree, categoryId);
    if (error) throw new TreeOpError(error);
    const next = cloneTree(tree);
    const node = next.categories.find((n) => n.category.id === categoryId);
    if (!node) throw new TreeOpError("That subfolder no longer exists.");
    node.category = { ...node.category, name: name.trim() };
    node.synthetic = false;
    return next;
  };
}

/** Delete a category; its channels move to the end of the uncategorized block. */
export function removeCategory(categoryId: string): TreeOp {
  return (tree) => {
    const next = cloneTree(tree);
    const i = next.categories.findIndex((n) => n.category.id === categoryId);
    if (i < 0) throw new TreeOpError("That subfolder no longer exists.");
    const [node] = next.categories.splice(i, 1);
    next.uncategorized.push(...node.channels);
    return next;
  };
}

/** Append a channel to a category (relay-only spaces, where channels live in the layout). */
export function addChannel(channel: SpaceChannel, categoryId: string | null): TreeOp {
  return (tree) => {
    if (flattenTree(tree).some((c) => c.id === channel.id)) throw new TreeOpError("That channel already exists.");
    const next = cloneTree(tree);
    bucket(next, categoryId).push({ ...channel, categoryId });
    return next;
  };
}

export function updateChannel(channelId: string, patch: Partial<Pick<SpaceChannel, "label" | "type" | "feedMode">>): TreeOp {
  return (tree) => {
    const next = cloneTree(tree);
    for (const list of [next.uncategorized, ...next.categories.map((n) => n.channels)]) {
      const i = list.findIndex((c) => c.id === channelId);
      if (i >= 0) {
        list[i] = { ...list[i], ...patch };
        return next;
      }
    }
    throw new TreeOpError("That channel no longer exists.");
  };
}

export function removeChannel(channelId: string): TreeOp {
  return (tree) => {
    const next = cloneTree(tree);
    for (const list of [next.uncategorized, ...next.categories.map((n) => n.channels)]) {
      const i = list.findIndex((c) => c.id === channelId);
      if (i >= 0) {
        list.splice(i, 1);
        return next;
      }
    }
    throw new TreeOpError("That channel no longer exists.");
  };
}

/** Where a channel sits: its category id (null = uncategorized) and index within it. */
export function locateChannel(tree: ChannelTree, channelId: string): { categoryId: string | null; index: number } | null {
  const i = tree.uncategorized.findIndex((c) => c.id === channelId);
  if (i >= 0) return { categoryId: null, index: i };
  for (const node of tree.categories) {
    const j = node.channels.findIndex((c) => c.id === channelId);
    if (j >= 0) return { categoryId: node.category.id, index: j };
  }
  return null;
}

/** The tree with only the channels `keep` accepts (categories are kept, possibly empty). */
export function filterTree(tree: ChannelTree, keep: (channel: SpaceChannel) => boolean): ChannelTree {
  return {
    uncategorized: tree.uncategorized.filter(keep),
    categories: tree.categories.map((n) => ({ ...n, channels: n.channels.filter(keep) })),
  };
}

/**
 * Translate a drop index in a filtered view (some channels hidden) to the
 * index `moveChannel` needs on the full tree: insert before the visible
 * channel that ends up after it, or last when it lands at the end.
 */
export function visibleToFullIndex(
  full: ChannelTree,
  visible: ChannelTree,
  channelId: string,
  categoryId: string | null,
  visibleIndex: number,
): number {
  const listOf = (t: ChannelTree) =>
    (categoryId === null ? t.uncategorized : t.categories.find((n) => n.category.id === categoryId)?.channels ?? [])
      .filter((c) => c.id !== channelId);
  const shown = listOf(visible);
  const all = listOf(full);
  const anchor = shown[visibleIndex];
  if (!anchor) return all.length;
  const i = all.findIndex((c) => c.id === anchor.id);
  return i >= 0 ? i : all.length;
}
