/**
 * Channel layout: categories ("subfolders"), channel order, and category
 * permission templates. Contract: docs/CHANNEL_LAYOUT.md.
 *
 * Invariants every mutation here keeps:
 *  - One transaction, serialized per space by a row lock on app.spaces
 *    (locking channel rows would not cover inserts).
 *  - Channel `position` is a single space-wide canonical order: uncategorized
 *    channels first, then each category (by its position) with its channels.
 *    Older clients sort by position alone and so keep seeing the same order.
 *  - Every layout change bumps `spaces.channel_layout_rev`, the optimistic lock
 *    the layout PUT checks.
 *  - Permission checks only ever read channel_overrides. Category overrides are
 *    templates copied onto the category's synced channels, so the backend's and
 *    the relay's evaluation paths are untouched.
 */
import { sql, eq, and, asc, inArray } from "drizzle-orm";
import { db } from "../db/connection.js";
import { spaces } from "../db/schema/spaces.js";
import { spaceChannels, spaceChannelCategories } from "../db/schema/channels.js";
import { channelOverrides, categoryOverrides, spaceRoles } from "../db/schema/permissions.js";
import { nanoid } from "../lib/id.js";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Tx | typeof db;

export const MAX_CATEGORIES = 50;
/** Server-side cap. Legacy free-text categories allowed 128; the UI caps at 50. */
export const MAX_CATEGORY_NAME = 128;
const MAX_DERIVED_ID = 64;
/** Positions at or above this sort after everything in their group until renumbered. */
const END_OF_GROUP = 1_000_000;

export class LayoutError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface CategoryRow {
  id: string;
  spaceId: string;
  name: string;
  position: number;
}

export interface LayoutDocInput {
  baseRevision: number;
  uncategorized: string[];
  categories: Array<{ id?: string; name: string; channelIds: string[] }>;
}

type RoleRank = { id: string; position: number; isAdmin: boolean };

/** What the acting member may do to other roles' channel permissions. */
export interface CopyAuthority {
  /**
   * May a category template be applied to a channel? `addedAllows` are the
   * allow-permissions it would add (never grantable beyond what the actor
   * holds). `replacing` = it would overwrite overrides the channel already
   * has, which also lifts their denies — that takes authority over every role.
   */
  mayApply(args: { roles: RoleRank[]; addedAllows: string[]; replacing: boolean }): boolean;
  /** Authority over every one of these roles' overrides. */
  mayManage(roles: RoleRank[]): boolean;
}

type OverrideInput = { allow: string[]; deny: string[] };

// ── Names and ids ────────────────────────────────────────────────────────

// C0/C1 controls, line/paragraph separators, bidi marks/embeddings/overrides/
// isolates (spoofing), zero-width space and BOM. ZWNJ/ZWJ (U+200C/D) stay
// allowed: emoji sequences and Persian/Indic text need them.
const FORBIDDEN_NAME_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b\u200e\u200f\u2028-\u202e\u2066-\u2069\ufeff]/;

/** Trim and validate a category name, or throw a 400. */
export function normalizeCategoryName(raw: string): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name) throw new LayoutError(400, "BAD_REQUEST", "A subfolder needs a name");
  if (name.length > MAX_CATEGORY_NAME) {
    throw new LayoutError(400, "BAD_REQUEST", `Subfolder names can be at most ${MAX_CATEGORY_NAME} characters`);
  }
  if (FORBIDDEN_NAME_CHARS.test(name)) {
    throw new LayoutError(400, "BAD_REQUEST", "Subfolder names can't contain control or invisible characters");
  }
  return name;
}

const UNSAFE_ID_CHARS = /[/?#%\\]/;

/**
 * A new category's id: its name when that is safe to keep as an opaque key
 * (older clients render the id as the header, so a readable id keeps them
 * correct until a rename), suffixed on collision; otherwise a random id.
 */
export function deriveCategoryId(name: string, taken: ReadonlySet<string>): string {
  const safe =
    name.length > 0 &&
    name.length <= MAX_DERIVED_ID &&
    name === name.trim() &&
    name !== "." &&
    name !== ".." &&
    !UNSAFE_ID_CHARS.test(name) &&
    !FORBIDDEN_NAME_CHARS.test(name);
  if (safe) {
    if (!taken.has(name)) return name;
    for (let n = 2; n < 100; n++) {
      const candidate = `${name}~${n}`;
      if (candidate.length <= MAX_DERIVED_ID && !taken.has(candidate)) return candidate;
    }
  }
  let id = nanoid(12);
  while (taken.has(id)) id = nanoid(12);
  return id;
}

/** Postgres unique_violation, possibly wrapped by Drizzle (DrizzleQueryError.cause). */
function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && typeof e === "object" && depth < 4; depth++) {
    if ((e as { code?: string }).code === "23505") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

// ── Transaction helpers ──────────────────────────────────────────────────

/** Lock the space row (serializes every layout write) and return its revision. */
async function lockSpace(tx: Tx, spaceId: string): Promise<number> {
  const rows = await tx
    .select({ rev: spaces.channelLayoutRev })
    .from(spaces)
    .where(eq(spaces.id, spaceId))
    .for("update");
  if (rows.length === 0) throw new LayoutError(404, "NOT_FOUND", "Space not found");
  return rows[0].rev;
}

async function bumpRevision(tx: Tx, spaceId: string): Promise<void> {
  await tx
    .update(spaces)
    .set({ channelLayoutRev: sql`${spaces.channelLayoutRev} + 1` })
    .where(eq(spaces.id, spaceId));
}

/** Rewrite positions 0..n-1 in canonical order (stable on current positions). */
async function renumber(tx: Tx, spaceId: string): Promise<void> {
  await tx.execute(sql`
    WITH ordered AS (
      SELECT c.id,
             (row_number() OVER (
                ORDER BY (c.category_id IS NOT NULL), cat.position, c.position, c.id
             )) - 1 AS rn
        FROM app.space_channels c
        LEFT JOIN app.space_channel_categories cat
          ON cat.space_id = c.space_id AND cat.id = c.category_id
       WHERE c.space_id = ${spaceId}
    )
    UPDATE app.space_channels c
       SET position = o.rn
      FROM ordered o
     WHERE o.id = c.id AND c.space_id = ${spaceId} AND c.position IS DISTINCT FROM o.rn
  `);
  // Category positions are dense too, so a client can treat them as indices.
  await tx.execute(sql`
    WITH ordered AS (
      SELECT id, (row_number() OVER (ORDER BY position, id)) - 1 AS rn
        FROM app.space_channel_categories
       WHERE space_id = ${spaceId}
    )
    UPDATE app.space_channel_categories cat
       SET position = o.rn
      FROM ordered o
     WHERE cat.space_id = ${spaceId} AND cat.id = o.id AND cat.position IS DISTINCT FROM o.rn
  `);
}

/** Copy a category's overrides onto channels (replacing theirs) and mark them synced. */
async function copyCategoryOverrides(
  tx: Tx,
  spaceId: string,
  categoryId: string,
  channelIds: string[],
  onlyRoleId?: string,
): Promise<void> {
  if (channelIds.length === 0) return;
  const template = await tx
    .select()
    .from(categoryOverrides)
    .where(
      and(
        eq(categoryOverrides.spaceId, spaceId),
        eq(categoryOverrides.categoryId, categoryId),
        ...(onlyRoleId ? [eq(categoryOverrides.roleId, onlyRoleId)] : []),
      ),
    );
  await tx
    .delete(channelOverrides)
    .where(
      and(
        inArray(channelOverrides.channelId, channelIds),
        ...(onlyRoleId ? [eq(channelOverrides.roleId, onlyRoleId)] : []),
      ),
    );
  const rows = channelIds.flatMap((channelId) =>
    template.map((t) => ({ roleId: t.roleId, channelId, permission: t.permission, effect: t.effect })),
  );
  if (rows.length > 0) await tx.insert(channelOverrides).values(rows);
}

async function rolesFor(tx: Tx, spaceId: string, roleIds: string[]) {
  if (roleIds.length === 0) return [];
  return tx
    .select({ id: spaceRoles.id, position: spaceRoles.position, isAdmin: spaceRoles.isAdmin })
    .from(spaceRoles)
    .where(and(eq(spaceRoles.spaceId, spaceId), inArray(spaceRoles.id, roleIds)));
}

/**
 * Channels that just moved into `categoryId` start following it when their
 * current overrides are not their own: none at all, or a synced copy of the
 * category they came from. Applying the template may only add allows the
 * actor holds; replacing existing copies also needs authority over every role
 * involved. Otherwise the channel moves but stays unsynced (someone with
 * authority can "Sync now"). Channels with overrides of their own keep them,
 * unsynced. `"always"` (a brand-new channel) applies the template as is: the
 * channel has no permissions of its own to override yet.
 * Returns true when channel_overrides changed.
 */
async function adoptCategory(
  tx: Tx,
  spaceId: string,
  categoryId: string,
  channelIds: string[],
  authority: CopyAuthority | "always",
): Promise<boolean> {
  if (channelIds.length === 0) return false;
  const synced = new Set(
    (
      await tx
        .select({ id: spaceChannels.id })
        .from(spaceChannels)
        .where(
          and(
            eq(spaceChannels.spaceId, spaceId),
            inArray(spaceChannels.id, channelIds),
            eq(spaceChannels.permissionsSynced, true),
          ),
        )
    ).map((r) => r.id),
  );
  const ownRows = await tx
    .select()
    .from(channelOverrides)
    .where(inArray(channelOverrides.channelId, channelIds));
  const template = await tx
    .select()
    .from(categoryOverrides)
    .where(and(eq(categoryOverrides.spaceId, spaceId), eq(categoryOverrides.categoryId, categoryId)));

  const follow: string[] = [];
  const unsynced: string[] = [];
  let changed = false;
  for (const id of channelIds) {
    const own = ownRows.filter((r) => r.channelId === id);
    if (own.length > 0 && !synced.has(id)) {
      unsynced.push(id);
      continue;
    }
    if (own.length === 0 && template.length === 0) {
      follow.push(id); // nothing to copy either way
      continue;
    }
    let allowed = authority === "always";
    if (!allowed) {
      const roleIds = [...new Set([...template, ...own].map((r) => r.roleId))];
      allowed = (authority as CopyAuthority).mayApply({
        roles: await rolesFor(tx, spaceId, roleIds),
        addedAllows: allowsAdded(own, template),
        replacing: own.length > 0,
      });
    }
    if (!allowed) {
      unsynced.push(id);
      continue;
    }
    await copyCategoryOverrides(tx, spaceId, categoryId, [id]);
    changed = true;
    follow.push(id);
  }
  if (follow.length > 0) {
    await tx
      .update(spaceChannels)
      .set({ permissionsSynced: true })
      .where(and(eq(spaceChannels.spaceId, spaceId), inArray(spaceChannels.id, follow)));
  }
  if (unsynced.length > 0) {
    await tx
      .update(spaceChannels)
      .set({ permissionsSynced: false })
      .where(and(eq(spaceChannels.spaceId, spaceId), inArray(spaceChannels.id, unsynced)));
  }
  return changed;
}

/** Allow-permissions a template would add to a channel's current rows (per role). */
function allowsAdded(
  current: Array<{ roleId: string; permission: string; effect: string }>,
  template: Array<{ roleId: string; permission: string; effect: string }>,
): string[] {
  const had = new Set(current.filter((r) => r.effect === "allow").map((r) => `${r.roleId}|${r.permission}`));
  return [
    ...new Set(
      template.filter((t) => t.effect === "allow" && !had.has(`${t.roleId}|${t.permission}`)).map((t) => t.permission),
    ),
  ];
}

/**
 * Resolve a channel's `categoryId` as sent by a client: an existing id, else
 * an existing name (case-insensitive — what older clients send, since they
 * treated the name as the id), else a new category with that name.
 */
async function resolveCategoryRef(tx: Tx, spaceId: string, ref: string): Promise<string | null> {
  const [byId] = await tx
    .select({ id: spaceChannelCategories.id })
    .from(spaceChannelCategories)
    .where(and(eq(spaceChannelCategories.spaceId, spaceId), eq(spaceChannelCategories.id, ref)))
    .limit(1);
  if (byId) return byId.id;

  if (!ref.trim()) return null;
  const name = normalizeCategoryName(ref);
  const [byName] = await tx
    .select({ id: spaceChannelCategories.id })
    .from(spaceChannelCategories)
    .where(
      and(
        eq(spaceChannelCategories.spaceId, spaceId),
        sql`lower(${spaceChannelCategories.name}) = lower(${name})`,
      ),
    )
    .limit(1);
  if (byName) return byName.id;

  const existing = await tx
    .select({ id: spaceChannelCategories.id, position: spaceChannelCategories.position })
    .from(spaceChannelCategories)
    .where(eq(spaceChannelCategories.spaceId, spaceId));
  if (existing.length >= MAX_CATEGORIES) {
    throw new LayoutError(400, "BAD_REQUEST", `A space can have at most ${MAX_CATEGORIES} subfolders`);
  }
  const id = deriveCategoryId(name, new Set(existing.map((c) => c.id)));
  const position = existing.reduce((max, c) => Math.max(max, c.position + 1), 0);
  await tx.insert(spaceChannelCategories).values({ spaceId, id, name, position });
  return id;
}

async function listChannelsTx(tx: Executor, spaceId: string) {
  return tx
    .select()
    .from(spaceChannels)
    .where(eq(spaceChannels.spaceId, spaceId))
    .orderBy(asc(spaceChannels.position), asc(spaceChannels.id));
}

async function listCategoriesTx(tx: Executor, spaceId: string): Promise<CategoryRow[]> {
  return tx
    .select({
      id: spaceChannelCategories.id,
      spaceId: spaceChannelCategories.spaceId,
      name: spaceChannelCategories.name,
      position: spaceChannelCategories.position,
    })
    .from(spaceChannelCategories)
    .where(eq(spaceChannelCategories.spaceId, spaceId))
    .orderBy(asc(spaceChannelCategories.position), asc(spaceChannelCategories.id));
}

function groupOverrides<T extends { permission: string; effect: string }>(
  rows: T[],
  key: (row: T) => string,
): Map<string, OverrideInput> {
  const out = new Map<string, OverrideInput>();
  for (const row of rows) {
    const k = key(row);
    let entry = out.get(k);
    if (!entry) out.set(k, (entry = { allow: [], deny: [] }));
    (row.effect === "deny" ? entry.deny : entry.allow).push(row.permission);
  }
  return out;
}

function overrideSignature(o: OverrideInput | undefined): string {
  if (!o) return "";
  return [...o.allow.map((p) => `a:${p}`), ...o.deny.map((p) => `d:${p}`)].sort().join(",");
}

/** A permission can't be both allowed and denied in one override. */
function assertNoOverlap(o: OverrideInput): void {
  const allow = new Set(o.allow);
  if (o.deny.some((p) => allow.has(p))) {
    throw new LayoutError(400, "BAD_REQUEST", "A permission can't be both allowed and denied");
  }
}

/** Allow-permissions added by this write (absent before), for grant checks. */
export function addedAllows(before: OverrideInput | undefined, after: OverrideInput): string[] {
  const had = new Set(before?.allow ?? []);
  return [...new Set(after.allow)].filter((p) => !had.has(p));
}

export interface OverrideWriteGuard {
  /** Throws (403/400) when the actor may not add these allow-permissions. */
  checkAddedAllows(perms: string[]): void;
}

// ── Public service ───────────────────────────────────────────────────────

export const channelLayoutService = {
  async getLayout(spaceId: string, executor: Executor = db) {
    const [space] = await executor
      .select({ rev: spaces.channelLayoutRev })
      .from(spaces)
      .where(eq(spaces.id, spaceId))
      .limit(1);
    if (!space) return null;
    const [categories, channels] = await Promise.all([
      listCategoriesTx(executor, spaceId),
      listChannelsTx(executor, spaceId),
    ]);
    return { revision: space.rev, categories, channels };
  },

  async listCategories(spaceId: string): Promise<CategoryRow[]> {
    return listCategoriesTx(db, spaceId);
  },

  /** Categories + revisions for many spaces at once (my-spaces hydration). */
  async layoutsForSpaces(spaceIds: string[]) {
    if (spaceIds.length === 0) return { categoriesBySpace: {}, revisionBySpace: {} };
    const [cats, revs] = await Promise.all([
      db
        .select({
          id: spaceChannelCategories.id,
          spaceId: spaceChannelCategories.spaceId,
          name: spaceChannelCategories.name,
          position: spaceChannelCategories.position,
        })
        .from(spaceChannelCategories)
        .where(inArray(spaceChannelCategories.spaceId, spaceIds))
        .orderBy(asc(spaceChannelCategories.position), asc(spaceChannelCategories.id)),
      db
        .select({ id: spaces.id, rev: spaces.channelLayoutRev })
        .from(spaces)
        .where(inArray(spaces.id, spaceIds)),
    ]);
    const categoriesBySpace: Record<string, CategoryRow[]> = {};
    for (const c of cats) (categoriesBySpace[c.spaceId] ??= []).push(c);
    const revisionBySpace: Record<string, number> = {};
    for (const r of revs) revisionBySpace[r.id] = r.rev;
    return { categoriesBySpace, revisionBySpace };
  },

  /**
   * Replace the whole layout. `doc` must list every channel exactly once;
   * categories it omits are deleted (their channels must be listed elsewhere),
   * categories without an id are created.
   */
  async putLayout(spaceId: string, doc: LayoutDocInput, authority: CopyAuthority) {
    let overridesChanged = false;
    const layout = await db.transaction(async (tx) => {
      const rev = await lockSpace(tx, spaceId);
      if (rev !== doc.baseRevision) {
        throw new LayoutError(409, "LAYOUT_STALE", "The channel layout changed; reload and try again");
      }

      const channels = await tx
        .select({ id: spaceChannels.id, categoryId: spaceChannels.categoryId })
        .from(spaceChannels)
        .where(eq(spaceChannels.spaceId, spaceId));
      const categories = await listCategoriesTx(tx, spaceId);

      // Categories. The cap only stops growth: spaces with more legacy
      // folders than that can still rearrange them.
      if (doc.categories.length > Math.max(MAX_CATEGORIES, categories.length)) {
        throw new LayoutError(400, "BAD_REQUEST", `A space can have at most ${MAX_CATEGORIES} subfolders`);
      }
      const existingById = new Map(categories.map((c) => [c.id, c]));
      const seenIds = new Set<string>();
      const seenNames = new Set<string>();
      const target = doc.categories.map((c) => {
        if (c.id !== undefined) {
          // Unknown with a current revision: the client's list was read in
          // pieces (channels, then categories). Let it refetch and retry.
          if (!existingById.has(c.id)) {
            throw new LayoutError(409, "LAYOUT_STALE", "That subfolder no longer exists; reload and try again");
          }
          if (seenIds.has(c.id)) throw new LayoutError(400, "BAD_REQUEST", "A subfolder is listed twice");
          seenIds.add(c.id);
        }
        // Only new or renamed names are validated; a legacy name that predates
        // the rules (an emoji sequence, a tab) can be kept as it is.
        const before = c.id !== undefined ? existingById.get(c.id)!.name : undefined;
        const name = before !== undefined && c.name === before ? before : normalizeCategoryName(c.name);
        const key = name.toLowerCase();
        if (seenNames.has(key)) {
          throw new LayoutError(400, "DUPLICATE_NAME", `Two subfolders can't both be named "${name}"`);
        }
        seenNames.add(key);
        return { id: c.id, name, channelIds: c.channelIds };
      });

      // Channels: exactly the current set, each once.
      const listed = [...doc.uncategorized, ...target.flatMap((c) => c.channelIds)];
      const seenChannels = new Set<string>();
      for (const id of listed) {
        if (seenChannels.has(id)) throw new LayoutError(400, "BAD_REQUEST", "A channel is listed twice");
        seenChannels.add(id);
      }
      const current = new Map(channels.map((c) => [c.id, c.categoryId]));
      if (seenChannels.size !== current.size || listed.some((id) => !current.has(id))) {
        throw new LayoutError(409, "LAYOUT_STALE", "The channel list changed; reload and try again");
      }

      // Ids for new categories never reuse one still present in this space.
      const taken = new Set(categories.map((c) => c.id));
      for (const c of target) {
        if (c.id === undefined) {
          c.id = deriveCategoryId(c.name, taken);
          taken.add(c.id);
        }
      }
      const keptIds = new Set(target.map((c) => c.id!));
      const deleted = categories.filter((c) => !keptIds.has(c.id)).map((c) => c.id);

      // Deleting a subfolder drops its permission template; one that holds
      // settings for roles above the actor isn't theirs to drop.
      if (deleted.length > 0) {
        const templateRoles = [
          ...new Set(
            (
              await tx
                .select({ roleId: categoryOverrides.roleId })
                .from(categoryOverrides)
                .where(and(eq(categoryOverrides.spaceId, spaceId), inArray(categoryOverrides.categoryId, deleted)))
            ).map((r) => r.roleId),
          ),
        ];
        if (templateRoles.length > 0 && !authority.mayManage(await rolesFor(tx, spaceId, templateRoles))) {
          throw new LayoutError(
            403,
            "FORBIDDEN",
            "That subfolder has permission settings for roles you can't manage",
          );
        }
      }

      try {
        // 1. Deleted categories: detach their channels, then drop them
        //    (their overrides cascade).
        if (deleted.length > 0) {
          await tx
            .update(spaceChannels)
            .set({ categoryId: null })
            .where(and(eq(spaceChannels.spaceId, spaceId), inArray(spaceChannels.categoryId, deleted)));
          await tx
            .delete(spaceChannelCategories)
            .where(and(eq(spaceChannelCategories.spaceId, spaceId), inArray(spaceChannelCategories.id, deleted)));
        }
        // 2. Park renamed categories on unique placeholder names, so swaps
        //    ("A"↔"B") don't trip the case-insensitive unique index midway.
        for (let i = 0; i < target.length; i++) {
          const c = target[i];
          const before = existingById.get(c.id!);
          if (before && before.name !== c.name) {
            await tx
              .update(spaceChannelCategories)
              .set({ name: `\u0001${i}` })
              .where(and(eq(spaceChannelCategories.spaceId, spaceId), eq(spaceChannelCategories.id, c.id!)));
          }
        }
        // 3. Final names + positions; insert new categories.
        for (let i = 0; i < target.length; i++) {
          const c = target[i];
          if (existingById.has(c.id!)) {
            await tx
              .update(spaceChannelCategories)
              .set({ name: c.name, position: i })
              .where(and(eq(spaceChannelCategories.spaceId, spaceId), eq(spaceChannelCategories.id, c.id!)));
          } else {
            await tx.insert(spaceChannelCategories).values({ spaceId, id: c.id!, name: c.name, position: i });
          }
        }
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new LayoutError(400, "DUPLICATE_NAME", "Two subfolders can't share a name");
        }
        throw err;
      }

      // 4. Channels: category + canonical position in one statement.
      const rows: Array<{ id: string; cat: string | null; pos: number }> = [];
      let pos = 0;
      for (const id of doc.uncategorized) rows.push({ id, cat: null, pos: pos++ });
      for (const c of target) for (const id of c.channelIds) rows.push({ id, cat: c.id!, pos: pos++ });
      if (rows.length > 0) {
        await tx.execute(sql`
          UPDATE app.space_channels c
             SET category_id = v.cat, position = v.pos
            FROM json_to_recordset(${JSON.stringify(rows)}::json) AS v(id text, cat text, pos int)
           WHERE c.id = v.id AND c.space_id = ${spaceId}
        `);
      }

      // 5. Permission sync for channels that changed category.
      const movedOut: string[] = [];
      const movedInto = new Map<string, string[]>();
      for (const r of rows) {
        if (current.get(r.id) === r.cat) continue;
        if (r.cat === null) movedOut.push(r.id);
        else (movedInto.get(r.cat) ?? movedInto.set(r.cat, []).get(r.cat)!).push(r.id);
      }
      if (movedOut.length > 0) {
        await tx
          .update(spaceChannels)
          .set({ permissionsSynced: false })
          .where(and(eq(spaceChannels.spaceId, spaceId), inArray(spaceChannels.id, movedOut)));
      }
      for (const [categoryId, ids] of movedInto) {
        if (await adoptCategory(tx, spaceId, categoryId, ids, authority)) overridesChanged = true;
      }

      await bumpRevision(tx, spaceId);
      return (await this.getLayout(spaceId, tx))!;
    });
    return { layout, overridesChanged };
  },

  /** Create a channel. A `categoryId` may be an id or (older clients) a name. */
  async createChannel(
    spaceId: string,
    params: {
      type: string;
      label: string;
      categoryId?: string | null;
      adminOnly?: boolean;
      slowModeSeconds?: number;
      temporary?: boolean;
      feedMode?: string;
    },
    uniqueFeedTypes: ReadonlySet<string>,
    newId: () => string,
  ) {
    return db.transaction(async (tx) => {
      await lockSpace(tx, spaceId);
      if (uniqueFeedTypes.has(params.type)) {
        const [existing] = await tx
          .select({ id: spaceChannels.id })
          .from(spaceChannels)
          .where(and(eq(spaceChannels.spaceId, spaceId), eq(spaceChannels.type, params.type)))
          .limit(1);
        if (existing) {
          throw new LayoutError(400, "BAD_REQUEST", `Only one ${params.type} channel is allowed per space`);
        }
      }
      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(spaceChannels)
        .where(eq(spaceChannels.spaceId, spaceId));

      const categoryId =
        typeof params.categoryId === "string" ? await resolveCategoryRef(tx, spaceId, params.categoryId) : null;

      const id = newId();
      try {
        await tx.insert(spaceChannels).values({
          id,
          spaceId,
          type: params.type,
          label: params.label,
          categoryId,
          position: END_OF_GROUP + count,
          isDefault: count === 0,
          adminOnly: params.adminOnly ?? false,
          slowModeSeconds: params.slowModeSeconds ?? 0,
          // Temporary = removed once its call room is empty: voice/video only.
          temporary: (params.type === "voice" || params.type === "video") && params.temporary === true,
          feedMode: params.feedMode ?? "all",
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new LayoutError(409, "CONFLICT", "A channel of that type with that name already exists");
        }
        throw err;
      }

      // A new channel inherits its category's permissions. It had none of its
      // own, so following the category's policy (set by someone allowed to)
      // can't widen what the creator could already do — and skipping it would
      // let new channels escape the category's restrictions.
      let overridesChanged = false;
      if (categoryId) overridesChanged = await adoptCategory(tx, spaceId, categoryId, [id], "always");

      await renumber(tx, spaceId);
      await bumpRevision(tx, spaceId);
      const [channel] = await tx.select().from(spaceChannels).where(eq(spaceChannels.id, id));
      return { channel, overridesChanged };
    });
  },

  /**
   * Update a channel. `categoryId` (id, legacy name, or null) moves it to the
   * end of that group; a bare `position` is an index within its current group.
   * Returns undefined when the channel isn't in this space.
   */
  async updateChannel(
    spaceId: string,
    channelId: string,
    updates: {
      label?: string;
      categoryId?: string | null;
      position?: number;
      adminOnly?: boolean;
      slowModeSeconds?: number;
      isDefault?: boolean;
      feedMode?: string;
    },
    authority: CopyAuthority,
  ) {
    return db.transaction(async (tx) => {
      await lockSpace(tx, spaceId);
      const [existing] = await tx
        .select()
        .from(spaceChannels)
        .where(and(eq(spaceChannels.id, channelId), eq(spaceChannels.spaceId, spaceId)))
        .limit(1);
      if (!existing) return undefined;

      const { categoryId: catRef, position, ...rest } = updates;
      let overridesChanged = false;

      if (rest.isDefault) {
        await tx.update(spaceChannels).set({ isDefault: false }).where(eq(spaceChannels.spaceId, spaceId));
      }
      try {
        if (Object.keys(rest).length > 0) {
          await tx
            .update(spaceChannels)
            .set(rest)
            .where(and(eq(spaceChannels.id, channelId), eq(spaceChannels.spaceId, spaceId)));
        }
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new LayoutError(409, "CONFLICT", "A channel of that type with that name already exists");
        }
        throw err;
      }

      if (catRef !== undefined) {
        const target = catRef === null ? null : await resolveCategoryRef(tx, spaceId, catRef);
        if (target !== existing.categoryId) {
          await tx
            .update(spaceChannels)
            .set({ categoryId: target, position: END_OF_GROUP })
            .where(eq(spaceChannels.id, channelId));
          if (target === null) {
            await tx.update(spaceChannels).set({ permissionsSynced: false }).where(eq(spaceChannels.id, channelId));
          } else {
            overridesChanged = await adoptCategory(tx, spaceId, target, [channelId], authority);
          }
        }
      } else if (position !== undefined) {
        // Legacy reorder of one channel: an index within its own group.
        const group = (
          await tx
            .select({ id: spaceChannels.id })
            .from(spaceChannels)
            .where(
              and(
                eq(spaceChannels.spaceId, spaceId),
                existing.categoryId === null
                  ? sql`${spaceChannels.categoryId} IS NULL`
                  : eq(spaceChannels.categoryId, existing.categoryId),
              ),
            )
            .orderBy(asc(spaceChannels.position), asc(spaceChannels.id))
        )
          .map((r) => r.id)
          .filter((id) => id !== channelId);
        group.splice(Math.min(position, group.length), 0, channelId);
        const rows = group.map((id, i) => ({ id, pos: i }));
        await tx.execute(sql`
          UPDATE app.space_channels c
             SET position = v.pos
            FROM json_to_recordset(${JSON.stringify(rows)}::json) AS v(id text, pos int)
           WHERE c.id = v.id AND c.space_id = ${spaceId}
        `);
      }

      await renumber(tx, spaceId);
      await bumpRevision(tx, spaceId);
      const [channel] = await tx.select().from(spaceChannels).where(eq(spaceChannels.id, channelId));
      return { channel, overridesChanged };
    });
  },

  /** Delete a channel (its overrides cascade); promotes the next default. */
  async deleteChannel(spaceId: string, channelId: string) {
    await db.transaction(async (tx) => {
      await lockSpace(tx, spaceId);
      const [channel] = await tx
        .select()
        .from(spaceChannels)
        .where(and(eq(spaceChannels.id, channelId), eq(spaceChannels.spaceId, spaceId)))
        .limit(1);
      if (!channel) throw new LayoutError(404, "NOT_FOUND", "Channel not found");

      await tx.delete(spaceChannels).where(and(eq(spaceChannels.id, channelId), eq(spaceChannels.spaceId, spaceId)));

      if (channel.isDefault) {
        const [next] = await tx
          .select({ id: spaceChannels.id })
          .from(spaceChannels)
          .where(eq(spaceChannels.spaceId, spaceId))
          .orderBy(asc(spaceChannels.position), asc(spaceChannels.id))
          .limit(1);
        if (next) await tx.update(spaceChannels).set({ isDefault: true }).where(eq(spaceChannels.id, next.id));
      }
      await bumpRevision(tx, spaceId);
    });
  },

  /** Legacy flat reorder: listed ids in that order, normalized into canonical groups. */
  async reorderChannels(spaceId: string, orderedIds: string[]) {
    await db.transaction(async (tx) => {
      await lockSpace(tx, spaceId);
      const channels = await tx
        .select({ id: spaceChannels.id, position: spaceChannels.position })
        .from(spaceChannels)
        .where(eq(spaceChannels.spaceId, spaceId));
      const index = new Map<string, number>();
      orderedIds.forEach((id, i) => {
        if (!index.has(id)) index.set(id, i);
      });
      const rows = channels.map((c) => ({
        id: c.id,
        pos: index.has(c.id) ? index.get(c.id)! : END_OF_GROUP + c.position,
      }));
      if (rows.length > 0) {
        await tx.execute(sql`
          UPDATE app.space_channels c
             SET position = v.pos
            FROM json_to_recordset(${JSON.stringify(rows)}::json) AS v(id text, pos int)
           WHERE c.id = v.id AND c.space_id = ${spaceId}
        `);
      }
      await renumber(tx, spaceId);
      await bumpRevision(tx, spaceId);
    });
  },

  // ── Category permission templates ──────────────────────────────────────

  async getCategoryOverrides(spaceId: string, roleId: string) {
    const [owned] = await db
      .select({ id: spaceRoles.id })
      .from(spaceRoles)
      .where(and(eq(spaceRoles.id, roleId), eq(spaceRoles.spaceId, spaceId)))
      .limit(1);
    if (!owned) throw new LayoutError(404, "NOT_FOUND", "Role not found");
    const rows = await db
      .select()
      .from(categoryOverrides)
      .where(and(eq(categoryOverrides.roleId, roleId), eq(categoryOverrides.spaceId, spaceId)));
    return [...groupOverrides(rows, (r) => r.categoryId)].map(([categoryId, o]) => ({
      roleId,
      categoryId,
      allow: o.allow,
      deny: o.deny,
    }));
  },

  /**
   * Replace one role's category overrides, then rewrite that role's rows on
   * every synced channel in the categories it touched.
   */
  async setCategoryOverrides(
    spaceId: string,
    roleId: string,
    overrides: Array<{ categoryId: string; allow: string[]; deny: string[] }>,
    guard: OverrideWriteGuard,
  ) {
    return this.writeCategoryOverrides(spaceId, roleId, overrides, guard, null);
  },

  async writeCategoryOverrides(
    spaceId: string,
    roleId: string,
    overrides: Array<{ categoryId: string; allow: string[]; deny: string[] }>,
    guard: OverrideWriteGuard,
    onlyCategoryId: string | null,
  ) {
    return db.transaction(async (tx) => {
      await lockSpace(tx, spaceId);
      const [owned] = await tx
        .select({ id: spaceRoles.id })
        .from(spaceRoles)
        .where(and(eq(spaceRoles.id, roleId), eq(spaceRoles.spaceId, spaceId)))
        .limit(1);
      if (!owned) throw new LayoutError(404, "NOT_FOUND", "Role not found");

      const categoryIds = new Set((await listCategoriesTx(tx, spaceId)).map((c) => c.id));
      const seen = new Set<string>();
      for (const o of overrides) {
        if (!categoryIds.has(o.categoryId)) throw new LayoutError(400, "BAD_REQUEST", "Unknown subfolder");
        if (seen.has(o.categoryId)) throw new LayoutError(400, "BAD_REQUEST", "A subfolder is listed twice");
        seen.add(o.categoryId);
        assertNoOverlap(o);
      }

      const scope = and(
        eq(categoryOverrides.roleId, roleId),
        eq(categoryOverrides.spaceId, spaceId),
        ...(onlyCategoryId !== null ? [eq(categoryOverrides.categoryId, onlyCategoryId)] : []),
      );
      const before = groupOverrides(await tx.select().from(categoryOverrides).where(scope), (r) => r.categoryId);
      for (const o of overrides) guard.checkAddedAllows(addedAllows(before.get(o.categoryId), o));

      const touched = [...new Set([...before.keys(), ...overrides.map((o) => o.categoryId)])].filter(
        (id) => overrideSignature(before.get(id)) !== overrideSignature(overrides.find((o) => o.categoryId === id)),
      );

      await tx.delete(categoryOverrides).where(scope);
      const rows = overrides.flatMap((o) => [
        ...[...new Set(o.allow)].map((permission) => ({ roleId, spaceId, categoryId: o.categoryId, permission, effect: "allow" })),
        ...[...new Set(o.deny)].map((permission) => ({ roleId, spaceId, categoryId: o.categoryId, permission, effect: "deny" })),
      ]);
      if (rows.length > 0) await tx.insert(categoryOverrides).values(rows);

      let channelsChanged = 0;
      for (const categoryId of touched) {
        const synced = (
          await tx
            .select({ id: spaceChannels.id })
            .from(spaceChannels)
            .where(
              and(
                eq(spaceChannels.spaceId, spaceId),
                eq(spaceChannels.categoryId, categoryId),
                eq(spaceChannels.permissionsSynced, true),
              ),
            )
        ).map((r) => r.id);
        await copyCategoryOverrides(tx, spaceId, categoryId, synced, roleId);
        channelsChanged += synced.length;
      }
      return { channelsChanged };
    });
  },

  /** Set one role's template on one category (empty lists clear it); its synced channels follow.
   *  Scoped to that category inside the lock, so concurrent edits to other
   *  categories of the same role can't overwrite each other. */
  async setCategoryOverride(
    spaceId: string,
    roleId: string,
    categoryId: string,
    override: OverrideInput,
    guard: OverrideWriteGuard,
  ) {
    return this.writeCategoryOverrides(spaceId, roleId, [{ categoryId, ...override }], guard, categoryId);
  },

  /**
   * Make a channel follow its category again: replace all of its overrides
   * with the category's. Every role on either side must be manageable.
   */
  async syncChannelPermissions(spaceId: string, channelId: string, authority: CopyAuthority) {
    return db.transaction(async (tx) => {
      await lockSpace(tx, spaceId);
      const [channel] = await tx
        .select()
        .from(spaceChannels)
        .where(and(eq(spaceChannels.id, channelId), eq(spaceChannels.spaceId, spaceId)))
        .limit(1);
      if (!channel) throw new LayoutError(404, "NOT_FOUND", "Channel not found");
      if (!channel.categoryId) throw new LayoutError(400, "BAD_REQUEST", "This channel isn't in a subfolder");

      const template = await tx
        .select()
        .from(categoryOverrides)
        .where(and(eq(categoryOverrides.spaceId, spaceId), eq(categoryOverrides.categoryId, channel.categoryId)));
      const own = await tx.select().from(channelOverrides).where(eq(channelOverrides.channelId, channelId));
      const roleIds = [...new Set([...template, ...own].map((r) => r.roleId))];
      const ok = authority.mayApply({
        roles: await rolesFor(tx, spaceId, roleIds),
        addedAllows: allowsAdded(own, template),
        replacing: true,
      });
      if (!ok) {
        throw new LayoutError(
          403,
          "FORBIDDEN",
          "Syncing would change permissions for roles you can't manage, or grant ones you don't have",
        );
      }
      await copyCategoryOverrides(tx, spaceId, channel.categoryId, [channelId]);
      await tx.update(spaceChannels).set({ permissionsSynced: true }).where(eq(spaceChannels.id, channelId));
      const [updated] = await tx.select().from(spaceChannels).where(eq(spaceChannels.id, channelId));
      return updated;
    });
  },

  /**
   * Replace one role's channel overrides (the legacy whole-role PUT). Diffs
   * per channel: only channels whose overrides for this role actually changed
   * stop following their category, so re-sending unchanged rows is harmless.
   */
  async setRoleChannelOverrides(
    spaceId: string,
    roleId: string,
    overrides: Array<{ channelId: string; allow: string[]; deny: string[] }>,
    guard: OverrideWriteGuard,
  ) {
    return this.writeChannelOverrides(spaceId, roleId, overrides, guard, null);
  },

  /** Set one role's overrides on one channel (empty lists clear them). */
  async setChannelOverride(
    spaceId: string,
    roleId: string,
    channelId: string,
    override: OverrideInput,
    guard: OverrideWriteGuard,
  ) {
    return this.writeChannelOverrides(spaceId, roleId, [{ channelId, ...override }], guard, channelId);
  },

  async writeChannelOverrides(
    spaceId: string,
    roleId: string,
    overrides: Array<{ channelId: string; allow: string[]; deny: string[] }>,
    guard: OverrideWriteGuard,
    onlyChannelId: string | null,
  ) {
    return db.transaction(async (tx) => {
      await lockSpace(tx, spaceId);
      const [owned] = await tx
        .select({ id: spaceRoles.id })
        .from(spaceRoles)
        .where(and(eq(spaceRoles.id, roleId), eq(spaceRoles.spaceId, spaceId)))
        .limit(1);
      if (!owned) throw new LayoutError(404, "NOT_FOUND", "Role not found");

      const spaceChannelIds = new Set(
        (
          await tx.select({ id: spaceChannels.id }).from(spaceChannels).where(eq(spaceChannels.spaceId, spaceId))
        ).map((c) => c.id),
      );
      const seen = new Set<string>();
      for (const o of overrides) {
        if (!spaceChannelIds.has(o.channelId)) throw new LayoutError(404, "NOT_FOUND", "Channel not found");
        if (seen.has(o.channelId)) throw new LayoutError(400, "BAD_REQUEST", "A channel is listed twice");
        seen.add(o.channelId);
        assertNoOverlap(o);
      }

      const scope = onlyChannelId ? [onlyChannelId] : [...spaceChannelIds];
      const beforeRows =
        scope.length === 0
          ? []
          : await tx
              .select()
              .from(channelOverrides)
              .where(and(eq(channelOverrides.roleId, roleId), inArray(channelOverrides.channelId, scope)));
      const before = groupOverrides(beforeRows, (r) => r.channelId);
      for (const o of overrides) guard.checkAddedAllows(addedAllows(before.get(o.channelId), o));

      const after = new Map(overrides.map((o) => [o.channelId, o]));
      const changed = [...new Set([...before.keys(), ...after.keys()])].filter(
        (id) => overrideSignature(before.get(id)) !== overrideSignature(after.get(id)),
      );

      if (scope.length > 0) {
        await tx
          .delete(channelOverrides)
          .where(and(eq(channelOverrides.roleId, roleId), inArray(channelOverrides.channelId, scope)));
      }
      const rows = overrides.flatMap((o) => [
        ...[...new Set(o.allow)].map((permission) => ({ roleId, channelId: o.channelId, permission, effect: "allow" })),
        ...[...new Set(o.deny)].map((permission) => ({ roleId, channelId: o.channelId, permission, effect: "deny" })),
      ]);
      if (rows.length > 0) await tx.insert(channelOverrides).values(rows);

      if (changed.length > 0) {
        await tx
          .update(spaceChannels)
          .set({ permissionsSynced: false })
          .where(
            and(
              eq(spaceChannels.spaceId, spaceId),
              inArray(spaceChannels.id, changed),
              eq(spaceChannels.permissionsSynced, true),
            ),
          );
      }
      return { changedChannels: changed };
    });
  },
};
