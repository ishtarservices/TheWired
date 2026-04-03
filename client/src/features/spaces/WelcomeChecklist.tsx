import { useState, useEffect, useCallback } from "react";
import { Check, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  fetchMyOnboardingState,
  completeTodoItem as completeTodoApi,
  fetchOnboardingPreview,
} from "../../lib/api/onboarding";
import type { OnboardingTodoItem } from "@/types/space";
import { useSpace } from "./useSpace";

interface WelcomeChecklistProps {
  spaceId: string;
  onDismiss?: () => void;
}

export function WelcomeChecklist({ spaceId, onDismiss }: WelcomeChecklistProps) {
  const { selectChannel } = useSpace();
  const [todoItems, setTodoItems] = useState<OnboardingTodoItem[]>([]);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // Fetch both the todo items definition and user's progress
        const [previewRes, stateRes] = await Promise.all([
          fetchOnboardingPreview(spaceId),
          fetchMyOnboardingState(spaceId),
        ]);

        if (cancelled) return;

        const items = previewRes.data?.todoItems ?? [];
        setTodoItems(items);

        const state = stateRes.data;
        if (state?.todoCompleted) {
          setCompleted(new Set(state.todoCompleted));
        }

        setLoaded(true);
      } catch {
        if (!cancelled) setLoaded(true);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [spaceId]);

  const handleComplete = useCallback(
    async (todoId: string) => {
      setCompleted((prev) => {
        const next = new Set(prev);
        next.add(todoId);
        return next;
      });

      try {
        await completeTodoApi(spaceId, todoId);
      } catch {
        // Revert on failure
        setCompleted((prev) => {
          const next = new Set(prev);
          next.delete(todoId);
          return next;
        });
      }
    },
    [spaceId],
  );

  if (!loaded || todoItems.length === 0) return null;

  const sorted = [...todoItems].sort((a, b) => a.position - b.position);
  const completedCount = sorted.filter((t) => completed.has(t.id)).length;
  const progress = sorted.length > 0 ? (completedCount / sorted.length) * 100 : 0;
  const allDone = completedCount === sorted.length;

  return (
    <div className="card-glass rounded-xl p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-heading">Getting Started</h4>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="rounded p-0.5 text-muted hover:text-heading transition-colors"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Progress bar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full bg-border overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500",
              allDone ? "bg-green-400" : "bg-primary",
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-[10px] text-muted shrink-0">
          {completedCount}/{sorted.length}
        </span>
      </div>

      {/* Items */}
      <div className="space-y-1">
        {sorted.map((item) => {
          const isDone = completed.has(item.id);

          return (
            <div
              key={item.id}
              className={cn(
                "flex items-start gap-2 rounded-lg px-2 py-1.5 transition-colors",
                isDone ? "opacity-50" : "hover:bg-surface-hover",
              )}
            >
              {/* Checkbox */}
              <button
                onClick={() => !isDone && handleComplete(item.id)}
                disabled={isDone}
                className={cn(
                  "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 transition-colors",
                  isDone
                    ? "border-green-400 bg-green-400"
                    : "border-border hover:border-primary",
                )}
              >
                {isDone && <Check size={10} className="text-white" />}
              </button>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <span
                  className={cn(
                    "text-xs",
                    isDone ? "text-muted line-through" : "text-heading",
                  )}
                >
                  {item.title}
                </span>
                {item.description && (
                  <p className="text-[10px] text-muted leading-snug">{item.description}</p>
                )}
              </div>

              {/* Channel link */}
              {item.linkChannelId && !isDone && (
                <button
                  onClick={() => selectChannel(item.linkChannelId!)}
                  className="shrink-0 text-muted hover:text-primary transition-colors"
                  title="Go to channel"
                >
                  <ChevronRight size={14} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {allDone && (
        <p className="text-center text-[10px] text-green-400 font-medium">
          All done! You're all set.
        </p>
      )}
    </div>
  );
}
