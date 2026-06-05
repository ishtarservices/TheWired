import { useRef, useState } from "react";
import { createSelector } from "@reduxjs/toolkit";
import { ChevronDown, Check, Cpu, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { PopoverMenu } from "@/components/ui/PopoverMenu";
import { useAppSelector } from "@/store/hooks";
import { selectProviderConfigs, selectAIPrefs } from "@/store/slices/aiSlice";
import type { RootState } from "@/store";
import { getDefaultProviderAndModel } from "./engine/llmManager";
import { setConversationModelEverywhere } from "./conversationActions";
import { setDefaultModelPref } from "./aiPrefsActions";

interface ModelGroup {
  providerId: string;
  label: string;
  connected: boolean;
  isDefaultProvider: boolean;
  models: string[];
}

/** Providers grouped with their models, sorted: default → connected → rest;
 *  each provider's chosen default model floats to the top of its group.
 *  Memoized so the header picker doesn't recompute on every streaming delta. */
const selectModelGroups = createSelector(
  [
    (s: RootState) => s.ai.providers,
    (s: RootState) => s.ai.providerStatus,
    (s: RootState) => s.ai.prefs.defaultProviderId,
  ],
  (providers, providerStatus, defaultProviderId): ModelGroup[] => {
    const groups: ModelGroup[] = [];
    for (const config of Object.values(providers)) {
      const status = providerStatus[config.id];
      let models = status?.models?.length
        ? status.models.map((m) => m.id)
        : config.defaultModel
          ? [config.defaultModel]
          : [];
      if (config.defaultModel && models.includes(config.defaultModel)) {
        models = [config.defaultModel, ...models.filter((m) => m !== config.defaultModel)];
      }
      if (models.length === 0) continue;
      groups.push({
        providerId: config.id,
        label: config.label,
        connected: status?.status === "connected",
        isDefaultProvider: defaultProviderId === config.id,
        models,
      });
    }
    groups.sort((a, b) => {
      if (a.isDefaultProvider !== b.isDefaultProvider) return a.isDefaultProvider ? -1 : 1;
      if (a.connected !== b.connected) return a.connected ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
    return groups;
  },
);

/**
 * Provider+model selector. With a `conversationId` it sets that conversation's
 * model (sticky); without one (e.g. a fresh tab) it sets the persisted default
 * used for new conversations.
 */
export function AIModelPicker({
  conversationId,
}: {
  conversationId: string | null;
}) {
  const groups = useAppSelector(selectModelGroups);
  const configs = useAppSelector(selectProviderConfigs);
  const prefs = useAppSelector(selectAIPrefs);
  const conversation = useAppSelector((s) =>
    conversationId ? s.ai.conversations.entities[conversationId] : undefined,
  );
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Only scan the store for a fallback when neither the conversation nor prefs
  // supply one (skips an unmemoized full scan on the common path / every delta).
  const primaryProviderId = conversation?.providerId ?? prefs.defaultProviderId;
  const primaryModel = conversation?.model ?? prefs.defaultModel;
  const fallback =
    !primaryProviderId || !primaryModel ? getDefaultProviderAndModel() : null;
  const currentProviderId = primaryProviderId ?? fallback?.providerId ?? null;
  const currentModel = primaryModel ?? fallback?.model ?? null;
  const currentLabel = configs.find((c) => c.id === currentProviderId)?.label;

  const select = (providerId: string, model: string) => {
    if (conversationId) setConversationModelEverywhere(conversationId, providerId, model);
    // Always remember the last-used model as the default for NEW chats (so
    // "Ask AI" / a fresh tab / an app restart reuse it instead of resetting).
    setDefaultModelPref(providerId, model);
    setOpen(false);
  };

  return (
    <span className="relative inline-block">
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex max-w-[220px] items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-soft transition-colors hover:bg-surface hover:text-heading"
      >
        <Cpu size={12} className="shrink-0" />
        <span className="truncate">{currentModel ?? currentLabel ?? "Select model"}</span>
        <ChevronDown size={12} className="shrink-0" />
      </button>

      {/* PopoverMenu gives Escape, click-outside, scroll-dismiss, viewport flip
          (the bare-div dropdown clipped against the 14px header). */}
      <PopoverMenu open={open} onClose={() => setOpen(false)} anchorRef={triggerRef} position="below">
        <div className="max-h-96 w-72 overflow-y-auto" role="listbox" aria-label="Model">
          {!conversationId && (
            <div className="px-3 pb-1 pt-1.5 text-[10px] text-muted">Default for new chats</div>
          )}
          {groups.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted">
              No models available. Add a provider in Settings → AI.
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.providerId} className="py-0.5">
                <div className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                  <span
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      group.connected ? "bg-green-400" : "bg-faint",
                    )}
                  />
                  <span className="truncate">{group.label}</span>
                  {group.isDefaultProvider && (
                    <Star size={9} className="shrink-0 fill-primary text-primary" />
                  )}
                </div>
                {group.models.map((model) => {
                  const selected =
                    group.providerId === currentProviderId && model === currentModel;
                  const isDefault =
                    group.isDefaultProvider && model === prefs.defaultModel;
                  return (
                    <button
                      key={`${group.providerId}:${model}`}
                      role="option"
                      aria-selected={selected}
                      onClick={() => select(group.providerId, model)}
                      className={cn(
                        "mx-1 flex w-[calc(100%-0.5rem)] items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-left text-xs transition-colors hover:bg-surface-hover",
                        selected ? "text-primary" : "text-heading",
                      )}
                    >
                      <span className="truncate">{model}</span>
                      <span className="flex shrink-0 items-center gap-1">
                        {isDefault && !selected && (
                          <Star size={11} className="fill-muted text-muted" />
                        )}
                        {selected && <Check size={13} />}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </PopoverMenu>
    </span>
  );
}
