import { useMemo, useRef, useState, type ReactNode, type CSSProperties } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import type { SpaceChannel } from "../../types/space";
import { flattenTree, locateChannel, moveChannel, type CategoryNode, type ChannelTree } from "./channelTree";

const CH = "ch:";
const CAT = "cat:";
const ZONE = "zone:";
const NONE = "__none__";

/** Spread onto the element that should start a drag (a grip, or the whole row). */
export interface DragHandle {
  ref: (el: HTMLElement | null) => void;
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners;
}

export interface ChannelRenderContext {
  handle?: DragHandle;
  dragging: boolean;
  overlay?: boolean;
}

export interface CategoryRenderContext extends ChannelRenderContext {
  /** A channel is being dragged over this subfolder. */
  dropTarget: boolean;
}

interface ChannelTreeDndProps {
  tree: ChannelTree;
  /** Drag-and-drop on (people who can manage channels). Off renders a plain list. */
  enabled: boolean;
  /** Keyboard dragging via the handle (needs a dedicated handle element, not the row button). */
  keyboard?: boolean;
  /** Collapsed subfolders hide their channels but still accept drops. */
  collapsed?: ReadonlySet<string>;
  onMoveChannel: (channelId: string, toCategoryId: string | null, index: number) => void;
  onMoveCategory: (categoryId: string, index: number) => void;
  renderChannel: (channel: SpaceChannel, ctx: ChannelRenderContext) => ReactNode;
  renderCategoryHeader: (node: CategoryNode, ctx: CategoryRenderContext) => ReactNode;
  /** Shown inside an expanded subfolder with no channels (only when enabled). */
  emptyCategoryHint?: ReactNode;
  /** Whether to render a category (e.g. hide empty ones from members). */
  showCategory?: (node: CategoryNode) => boolean;
}

const zoneId = (categoryId: string | null) => `${ZONE}${categoryId ?? NONE}`;
const zoneCategory = (id: string): string | null => {
  const raw = id.slice(ZONE.length);
  return raw === NONE ? null : raw;
};

function channelsOf(tree: ChannelTree, categoryId: string | null): SpaceChannel[] {
  if (categoryId === null) return tree.uncategorized;
  return tree.categories.find((n) => n.category.id === categoryId)?.channels ?? [];
}

/** Which category a droppable id points into (null = uncategorized), or undefined. */
function targetCategory(tree: ChannelTree, overId: string): string | null | undefined {
  if (overId.startsWith(ZONE)) return zoneCategory(overId);
  if (overId.startsWith(CH)) return locateChannel(tree, overId.slice(CH.length))?.categoryId;
  if (overId.startsWith(CAT)) return overId.slice(CAT.length);
  return undefined;
}

/**
 * Where a dragged channel lands. `preview` already holds any cross-subfolder
 * move made while dragging. Within its list, the sortable animation shows the
 * channel taking the hovered channel's slot (arrayMove semantics) — except
 * right after a crossing, where it already sits where it was inserted.
 */
export function resolveChannelDrop(
  preview: ChannelTree,
  channelId: string,
  overId: string | null,
  crossedAgainst: string | null,
): { categoryId: string | null; index: number } | null {
  const at = locateChannel(preview, channelId);
  if (!at) return null;
  let index = at.index;
  if (overId?.startsWith(CH) && overId !== CH + channelId && overId !== crossedAgainst) {
    const i = channelsOf(preview, at.categoryId).findIndex((c) => c.id === overId.slice(CH.length));
    if (i >= 0) index = i;
  }
  return { categoryId: at.categoryId, index };
}

/**
 * The channel tree with drag-and-drop: channels reorder within and move across
 * subfolders (including into collapsed or empty ones), subfolders reorder.
 * Moves are previewed locally while dragging and committed once on drop.
 */
export function ChannelTreeDnd(props: ChannelTreeDndProps) {
  if (!props.enabled) return <PlainTree {...props} />;
  return <DndTree {...props} />;
}

function PlainTree({ tree, collapsed, renderChannel, renderCategoryHeader, showCategory }: ChannelTreeDndProps) {
  return (
    <div>
      {tree.uncategorized.map((ch) => (
        <div key={ch.id}>{renderChannel(ch, { dragging: false })}</div>
      ))}
      {tree.categories.filter((n) => showCategory?.(n) ?? true).map((node) => (
        <div key={node.category.id}>
          {renderCategoryHeader(node, { dragging: false, dropTarget: false })}
          {!collapsed?.has(node.category.id) &&
            node.channels.map((ch) => <div key={ch.id}>{renderChannel(ch, { dragging: false })}</div>)}
        </div>
      ))}
    </div>
  );
}

function DndTree({
  tree,
  keyboard,
  collapsed,
  onMoveChannel,
  onMoveCategory,
  renderChannel,
  renderCategoryHeader,
  emptyCategoryHint,
  showCategory,
}: ChannelTreeDndProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ChannelTree | null>(null);
  /** The channel a cross-subfolder insertion was placed against. Dropping
   *  while still over it keeps that slot — it's already where the preview shows. */
  const crossedAgainst = useRef<string | null>(null);
  const shown = preview ?? tree;

  const pointer = useSensor(PointerSensor, { activationConstraint: { distance: 6 } });
  const keys = useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates });
  const sensors = useSensors(...(keyboard ? [pointer, keys] : [pointer]));

  const collision: CollisionDetection = useMemo(
    () => (args) => {
      const dragging = String(args.active.id);
      if (dragging.startsWith(CAT)) {
        return closestCenter({
          ...args,
          droppableContainers: args.droppableContainers.filter((c) => String(c.id).startsWith(CAT)),
        });
      }
      const candidates = args.droppableContainers.filter((c) => !String(c.id).startsWith(CAT));
      const within = pointerWithin({ ...args, droppableContainers: candidates });
      if (within.length > 0) {
        const items = within.filter((c) => String(c.id).startsWith(CH));
        return items.length > 0 ? items : within;
      }
      return closestCenter({ ...args, droppableContainers: candidates });
    },
    [],
  );

  const activeChannel = activeId?.startsWith(CH)
    ? flattenTree(shown).find((c) => c.id === activeId.slice(CH.length))
    : undefined;
  const activeCategory = activeId?.startsWith(CAT)
    ? shown.categories.find((n) => n.category.id === activeId.slice(CAT.length))
    : undefined;
  const hoverCategory =
    activeChannel !== undefined ? locateChannel(shown, activeChannel.id)?.categoryId ?? null : undefined;

  function reset() {
    setActiveId(null);
    setPreview(null);
    crossedAgainst.current = null;
  }

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
    setPreview(String(e.active.id).startsWith(CH) ? tree : null);
  }

  function handleDragOver(e: DragOverEvent) {
    const active = String(e.active.id);
    if (!active.startsWith(CH) || !e.over || !preview) return;
    const channelId = active.slice(CH.length);
    const overId = String(e.over.id);
    const target = targetCategory(preview, overId);
    if (target === undefined) return;
    const from = locateChannel(preview, channelId);
    if (!from || from.categoryId === target) return;
    // Crossing into another subfolder: place it before or after the hovered
    // channel (whichever half the dragged item is over), or last.
    const list = channelsOf(preview, target);
    const overIndex = overId.startsWith(CH) ? list.findIndex((c) => c.id === overId.slice(CH.length)) : -1;
    let index = list.length;
    if (overIndex >= 0) {
      const dragged = e.active.rect.current.translated;
      const below = !!dragged && dragged.top + dragged.height / 2 > e.over.rect.top + e.over.rect.height / 2;
      index = overIndex + (below ? 1 : 0);
    }
    crossedAgainst.current = overId;
    setPreview(moveChannel(channelId, target, index)(preview));
  }

  function handleDragEnd(e: DragEndEvent) {
    const active = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;

    if (active.startsWith(CAT)) {
      const categoryId = active.slice(CAT.length);
      if (overId?.startsWith(CAT) && overId !== active) {
        const to = tree.categories.findIndex((n) => n.category.id === overId.slice(CAT.length));
        if (to >= 0) onMoveCategory(categoryId, to);
      }
      reset();
      return;
    }

    if (active.startsWith(CH) && preview) {
      const channelId = active.slice(CH.length);
      const drop = resolveChannelDrop(preview, channelId, overId, crossedAgainst.current);
      const before = locateChannel(tree, channelId);
      if (drop && (!before || before.categoryId !== drop.categoryId || before.index !== drop.index)) {
        onMoveChannel(channelId, drop.categoryId, drop.index);
      }
    }
    reset();
  }

  const visibleCategories = shown.categories.filter((n) => showCategory?.(n) ?? true);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={reset}
    >
      <Zone id={zoneId(null)} highlight={hoverCategory === null && !!activeChannel}>
        <SortableContext items={shown.uncategorized.map((c) => CH + c.id)} strategy={verticalListSortingStrategy}>
          {shown.uncategorized.map((ch) => (
            <SortableChannel key={ch.id} channel={ch} render={renderChannel} />
          ))}
        </SortableContext>
        {activeChannel && shown.uncategorized.length === 0 && (
          <div className="mx-2 my-1 rounded-lg border border-dashed border-border px-2 py-1.5 text-[10px] text-muted">
            Drop here to take it out of its subfolder
          </div>
        )}
      </Zone>

      <SortableContext items={visibleCategories.map((n) => CAT + n.category.id)} strategy={verticalListSortingStrategy}>
        {visibleCategories.map((node) => (
          <SortableCategory
            key={node.category.id}
            node={node}
            collapsed={collapsed?.has(node.category.id) ?? false}
            dropTarget={hoverCategory === node.category.id}
            renderHeader={renderCategoryHeader}
            renderChannel={renderChannel}
            emptyHint={emptyCategoryHint}
          />
        ))}
      </SortableContext>

      <DragOverlay dropAnimation={null}>
        {activeChannel
          ? renderChannel(activeChannel, { dragging: true, overlay: true })
          : activeCategory
            ? renderCategoryHeader(activeCategory, { dragging: true, overlay: true, dropTarget: false })
            : null}
      </DragOverlay>
    </DndContext>
  );
}

function Zone({ id, highlight, children }: { id: string; highlight: boolean; children: ReactNode }) {
  const { setNodeRef } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={cn("rounded-xl transition-colors", highlight && "bg-primary/5")}>
      {children}
    </div>
  );
}

function SortableChannel({
  channel,
  render,
}: {
  channel: SpaceChannel;
  render: (channel: SpaceChannel, ctx: ChannelRenderContext) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: CH + channel.id,
  });
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : undefined,
  };
  return (
    <div ref={setNodeRef} style={style}>
      {render(channel, { dragging: isDragging, handle: { ref: setActivatorNodeRef, attributes, listeners } })}
    </div>
  );
}

function SortableCategory({
  node,
  collapsed,
  dropTarget,
  renderHeader,
  renderChannel,
  emptyHint,
}: {
  node: CategoryNode;
  collapsed: boolean;
  dropTarget: boolean;
  renderHeader: (node: CategoryNode, ctx: CategoryRenderContext) => ReactNode;
  renderChannel: (channel: SpaceChannel, ctx: ChannelRenderContext) => ReactNode;
  emptyHint?: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: CAT + node.category.id,
  });
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : undefined,
  };
  return (
    <div ref={setNodeRef} style={style}>
      <Zone id={zoneId(node.category.id)} highlight={dropTarget}>
        {renderHeader(node, {
          dragging: isDragging,
          dropTarget,
          handle: { ref: setActivatorNodeRef, attributes, listeners },
        })}
        {!collapsed && (
          <SortableContext items={node.channels.map((c) => CH + c.id)} strategy={verticalListSortingStrategy}>
            {node.channels.map((ch) => (
              <SortableChannel key={ch.id} channel={ch} render={renderChannel} />
            ))}
            {node.channels.length === 0 && emptyHint}
          </SortableContext>
        )}
      </Zone>
    </div>
  );
}
