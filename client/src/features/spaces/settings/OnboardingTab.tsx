import { useState, useEffect, useRef } from "react";
import {
  ChevronDown,
  ChevronRight,
  Trash2,
  Plus,
  GripVertical,
  Asterisk,
  ListChecks,
  Link2,
  CheckCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "../../../components/ui/Button";
import { Spinner } from "../../../components/ui/Spinner";
import { ImageUpload } from "../../../components/ui/ImageUpload";
import { useOnboarding } from "../useOnboarding";
import { useRoles } from "../useRoles";
import { useSpaceChannels } from "../useSpaceChannels";
import type { OnboardingQuestion, OnboardingAnswer } from "@/types/space";

interface OnboardingTabProps {
  spaceId: string;
}

export function OnboardingTab({ spaceId }: OnboardingTabProps) {
  const {
    config,
    questions,
    todoItems,
    isLoading,
    updateConfig,
    addQuestion,
    editQuestion,
    removeQuestion,
    addAnswer,
    editAnswer,
    removeAnswer,
    saveMappings,
    addTodoItem,
    editTodoItem,
    removeTodoItem,
  } = useOnboarding(spaceId);

  if (isLoading && !config) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h3 className="text-sm font-semibold text-heading">Community Onboarding</h3>
      <p className="text-xs text-muted">
        Guide new members through a customized survey to auto-assign roles and channels based on their interests.
      </p>

      {/* General Config */}
      <ConfigSection config={config} onUpdate={updateConfig} />

      {/* Questions */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">Questions</h4>
        <QuestionsBuilder
          spaceId={spaceId}
          questions={questions}
          onAddQuestion={addQuestion}
          onEditQuestion={editQuestion}
          onRemoveQuestion={removeQuestion}
          onAddAnswer={addAnswer}
          onEditAnswer={editAnswer}
          onRemoveAnswer={removeAnswer}
          onSaveMappings={saveMappings}
        />
      </div>

      {/* Todo Checklist */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">Welcome Checklist</h4>
        <p className="text-[11px] text-muted">
          Suggested actions for new members after they join.
        </p>
        <TodoSection
          todoItems={todoItems}
          onAdd={addTodoItem}
          onEdit={editTodoItem}
          onRemove={removeTodoItem}
        />
      </div>
    </div>
  );
}

// ── Save Indicator ──────────────────────────────────────────────────

function useSaveFlash() {
  const [saved, setSaved] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function flash() {
    setSaved(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setSaved(false), 2000);
  }

  return { saved, flash };
}

function SavedBadge({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-green-400 animate-in fade-in duration-200">
      <CheckCircle size={10} />
      Saved
    </span>
  );
}

// ── Config Section ──────────────────────────────────────────────────

function ConfigSection({
  config,
  onUpdate,
}: {
  config: ReturnType<typeof useOnboarding>["config"];
  onUpdate: ReturnType<typeof useOnboarding>["updateConfig"];
}) {
  const { saved, flash } = useSaveFlash();

  async function handleUpdate(params: Parameters<typeof onUpdate>[0]) {
    await onUpdate(params);
    flash();
  }

  return (
    <div className="space-y-3 card-glass rounded-xl p-4">
      {/* Enable toggle */}
      <div className="flex items-center justify-between">
        <label className="flex items-center justify-between flex-1 cursor-pointer">
          <span className="text-sm text-heading">Enable Onboarding</span>
          <button
            role="switch"
            aria-checked={config?.enabled ?? false}
            onClick={() => handleUpdate({ enabled: !(config?.enabled ?? false) })}
            className={cn(
              "relative h-5 w-9 rounded-full transition-colors",
              config?.enabled ? "bg-primary" : "bg-surface-hover",
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform",
                config?.enabled ? "translate-x-4" : "",
              )}
            />
          </button>
        </label>
        <SavedBadge visible={saved} />
      </div>

      {/* Require completion */}
      <label className="flex items-center gap-2 text-xs text-body cursor-pointer">
        <input
          type="checkbox"
          checked={config?.requireCompletion ?? false}
          onChange={(e) => handleUpdate({ requireCompletion: e.target.checked })}
          className="rounded border-border"
        />
        <span>Require completion before showing all channels</span>
      </label>

      {/* Welcome Message */}
      <div>
        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted">
          Welcome Message
        </label>
        <WelcomeMessageField
          value={config?.welcomeMessage ?? ""}
          onSave={(val) => handleUpdate({ welcomeMessage: val || null })}
        />
      </div>

      {/* Welcome Banner Image */}
      <ImageUpload
        value={config?.welcomeImage ?? ""}
        onChange={(url) => handleUpdate({ welcomeImage: url || null })}
        label="Welcome Banner"
        placeholder="Upload a banner image or paste URL"
        shape="banner"
      />
    </div>
  );
}

// ── Welcome Message Field (saves on blur) ───────────────────────────

function WelcomeMessageField({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [local, setLocal] = useState(value);

  // Sync if parent value changes (e.g. after initial load)
  useEffect(() => { setLocal(value); }, [value]);

  return (
    <textarea
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        if (local !== value) onSave(local);
      }}
      placeholder="Welcome to our community! Here's what we're about..."
      rows={3}
      className="w-full rounded-xl bg-field border border-border px-3 py-2 text-sm text-heading placeholder-muted focus:border-primary focus:outline-none resize-none transition-colors"
    />
  );
}

// ── Questions Builder ───────────────────────────────────────────────

function QuestionsBuilder({
  spaceId,
  questions,
  onAddQuestion,
  onEditQuestion,
  onRemoveQuestion,
  onAddAnswer,
  onEditAnswer,
  onRemoveAnswer,
  onSaveMappings,
}: {
  spaceId: string;
  questions: OnboardingQuestion[];
  onAddQuestion: (p: { title: string }) => Promise<void>;
  onEditQuestion: (id: string, p: { title?: string; description?: string | null; required?: boolean; multiple?: boolean }) => Promise<void>;
  onRemoveQuestion: (id: string) => Promise<void>;
  onAddAnswer: (qId: string, p: { label: string; emoji?: string }) => Promise<void>;
  onEditAnswer: (aId: string, p: { label?: string; emoji?: string | null }) => Promise<void>;
  onRemoveAnswer: (aId: string) => Promise<void>;
  onSaveMappings: (aId: string, m: Array<{ roleId?: string | null; channelId?: string | null }>) => Promise<void>;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [adding, setAdding] = useState(false);

  const sorted = [...questions].sort((a, b) => a.position - b.position);

  async function handleAdd() {
    if (!newTitle.trim()) return;
    setAdding(true);
    await onAddQuestion({ title: newTitle.trim() });
    setNewTitle("");
    setAdding(false);
  }

  return (
    <div className="space-y-2">
      {sorted.length === 0 && (
        <p className="text-xs text-muted italic py-2">
          No questions yet. Add one below to get started.
        </p>
      )}

      {sorted.map((q) => (
        <QuestionCard
          key={q.id}
          spaceId={spaceId}
          question={q}
          expanded={expandedId === q.id}
          onToggle={() => setExpandedId(expandedId === q.id ? null : q.id)}
          onEdit={onEditQuestion}
          onRemove={onRemoveQuestion}
          onAddAnswer={onAddAnswer}
          onEditAnswer={onEditAnswer}
          onRemoveAnswer={onRemoveAnswer}
          onSaveMappings={onSaveMappings}
        />
      ))}

      <div className="flex gap-2">
        <input
          type="text"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="e.g. What are your interests?"
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          className="flex-1 rounded-xl bg-field border border-border px-3 py-1.5 text-sm text-heading placeholder-muted focus:border-primary focus:outline-none transition-colors"
        />
        <Button variant="accent" size="md" onClick={handleAdd} disabled={!newTitle.trim() || adding}>
          {adding ? <Spinner size="sm" /> : <><Plus size={14} className="mr-1" />Add</>}
        </Button>
      </div>
    </div>
  );
}

// ── Question Card ───────────────────────────────────────────────────

function QuestionCard({
  spaceId,
  question,
  expanded,
  onToggle,
  onEdit,
  onRemove,
  onAddAnswer,
  onEditAnswer,
  onRemoveAnswer,
  onSaveMappings,
}: {
  spaceId: string;
  question: OnboardingQuestion;
  expanded: boolean;
  onToggle: () => void;
  onEdit: (id: string, p: { title?: string; description?: string | null; required?: boolean; multiple?: boolean }) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onAddAnswer: (qId: string, p: { label: string; emoji?: string }) => Promise<void>;
  onEditAnswer: (aId: string, p: { label?: string; emoji?: string | null }) => Promise<void>;
  onRemoveAnswer: (aId: string) => Promise<void>;
  onSaveMappings: (aId: string, m: Array<{ roleId?: string | null; channelId?: string | null }>) => Promise<void>;
}) {
  const [newAnswerLabel, setNewAnswerLabel] = useState("");
  const { saved, flash } = useSaveFlash();

  async function handleAddAnswer() {
    if (!newAnswerLabel.trim()) return;
    await onAddAnswer(question.id, { label: newAnswerLabel.trim() });
    setNewAnswerLabel("");
  }

  async function handleEdit(params: Parameters<typeof onEdit>[1]) {
    await onEdit(question.id, params);
    flash();
  }

  return (
    <div className="card-glass rounded-xl overflow-hidden">
      {/* Header */}
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-sm hover:bg-surface-hover transition-colors"
      >
        <GripVertical size={12} className="text-muted shrink-0" />
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="text-heading font-medium flex-1 text-left truncate">
          {question.title}
        </span>
        {question.required && (
          <span className="flex items-center gap-0.5 rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-400">
            <Asterisk size={8} />
            Required
          </span>
        )}
        {question.multiple && (
          <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-400">Multi</span>
        )}
        <span className="text-[10px] text-muted">{question.answers.length} answers</span>
      </button>

      {/* Expanded Content */}
      {expanded && (
        <div className="border-t border-border p-3 space-y-3">
          {/* Title */}
          <div>
            <label className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
              Question
              <SavedBadge visible={saved} />
            </label>
            <input
              value={question.title}
              onChange={(e) => handleEdit({ title: e.target.value })}
              className="w-full rounded-xl bg-field border border-border px-2 py-1 text-sm text-heading focus:border-primary focus:outline-none"
            />
          </div>

          {/* Description */}
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted">
              Helper Text
            </label>
            <input
              value={question.description ?? ""}
              onChange={(e) => handleEdit({ description: e.target.value || null })}
              placeholder="Optional description shown below the question..."
              className="w-full rounded-xl bg-field border border-border px-2 py-1 text-sm text-heading placeholder-muted focus:border-primary focus:outline-none"
            />
          </div>

          {/* Toggles */}
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-xs text-body cursor-pointer">
              <input
                type="checkbox"
                checked={question.required}
                onChange={(e) => handleEdit({ required: e.target.checked })}
                className="rounded border-border"
              />
              Required
            </label>
            <label className="flex items-center gap-2 text-xs text-body cursor-pointer">
              <input
                type="checkbox"
                checked={question.multiple}
                onChange={(e) => handleEdit({ multiple: e.target.checked })}
                className="rounded border-border"
              />
              Allow multiple answers
            </label>
          </div>

          {/* Answers */}
          <div>
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-muted">
              Answer Options
            </label>

            {question.answers.length === 0 && (
              <p className="text-[11px] text-muted italic mb-2">
                Add answer choices below. Members will pick from these options.
              </p>
            )}

            <div className="space-y-1.5">
              {question.answers
                .sort((a, b) => a.position - b.position)
                .map((answer) => (
                  <AnswerRow
                    key={answer.id}
                    spaceId={spaceId}
                    answer={answer}
                    onEdit={onEditAnswer}
                    onRemove={onRemoveAnswer}
                    onSaveMappings={onSaveMappings}
                  />
                ))}

              {/* Inline add answer */}
              <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-2 py-1.5">
                <Plus size={12} className="text-muted shrink-0" />
                <input
                  type="text"
                  value={newAnswerLabel}
                  onChange={(e) => setNewAnswerLabel(e.target.value)}
                  placeholder="Type an answer and press Enter..."
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddAnswer();
                    }
                  }}
                  className="flex-1 bg-transparent text-xs text-heading placeholder-muted focus:outline-none"
                />
                {newAnswerLabel.trim() && (
                  <button
                    onClick={handleAddAnswer}
                    className="text-[10px] text-primary hover:text-primary/80 font-medium shrink-0"
                  >
                    Add
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Delete question */}
          <div className="pt-1 border-t border-border">
            <Button
              variant="ghost"
              size="sm"
              className="text-red-400 hover:bg-red-500/10"
              onClick={() => onRemove(question.id)}
            >
              <Trash2 size={14} className="mr-1" />
              Delete Question
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Answer Row ──────────────────────────────────────────────────────

function AnswerRow({
  spaceId,
  answer,
  onEdit,
  onRemove,
  onSaveMappings,
}: {
  spaceId: string;
  answer: OnboardingAnswer;
  onEdit: (id: string, p: { label?: string; emoji?: string | null }) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onSaveMappings: (id: string, m: Array<{ roleId?: string | null; channelId?: string | null }>) => Promise<void>;
}) {
  const [showMappings, setShowMappings] = useState(false);
  const { roles } = useRoles(spaceId);
  const { channels } = useSpaceChannels(spaceId);

  const nonAdminRoles = roles.filter((r) => !r.isAdmin && !r.isDefault);

  return (
    <div className="rounded-lg bg-surface/50 border border-border p-2 space-y-2">
      <div className="flex items-center gap-2">
        {/* Emoji */}
        <input
          value={answer.emoji ?? ""}
          onChange={(e) => onEdit(answer.id, { emoji: e.target.value || null })}
          placeholder="?"
          maxLength={2}
          className="w-8 rounded bg-field border border-border px-1 py-0.5 text-center text-sm focus:border-primary focus:outline-none"
        />
        {/* Label */}
        <input
          value={answer.label}
          onChange={(e) => onEdit(answer.id, { label: e.target.value })}
          className="flex-1 rounded-lg bg-field border border-border px-2 py-0.5 text-xs text-heading focus:border-primary focus:outline-none"
        />
        {/* Mapping toggle */}
        <button
          onClick={() => setShowMappings(!showMappings)}
          className={cn(
            "rounded-lg px-2 py-0.5 text-[10px] transition-colors",
            answer.mappings.length > 0
              ? "bg-primary/10 text-primary"
              : "bg-surface-hover text-muted hover:text-soft",
          )}
        >
          <Link2 size={10} className="inline mr-0.5" />
          {answer.mappings.length > 0 ? `${answer.mappings.length} mapped` : "Map"}
        </button>
        {/* Delete */}
        <button
          onClick={() => onRemove(answer.id)}
          className="text-muted hover:text-red-400 transition-colors"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* Mapping Editor */}
      {showMappings && (
        <MappingEditor
          answer={answer}
          roles={nonAdminRoles}
          channels={channels}
          onSave={onSaveMappings}
        />
      )}
    </div>
  );
}

// ── Mapping Editor ──────────────────────────────────────────────────

function MappingEditor({
  answer,
  roles,
  channels,
  onSave,
}: {
  answer: OnboardingAnswer;
  roles: Array<{ id: string; name: string; color?: string }>;
  channels: Array<{ id: string; label: string; type: string }>;
  onSave: (aId: string, m: Array<{ roleId?: string | null; channelId?: string | null }>) => Promise<void>;
}) {
  const [selectedRoles, setSelectedRoles] = useState<string[]>(
    answer.mappings.filter((m) => m.roleId).map((m) => m.roleId!),
  );
  const [selectedChannels, setSelectedChannels] = useState<string[]>(
    answer.mappings.filter((m) => m.channelId).map((m) => m.channelId!),
  );
  const [saving, setSaving] = useState(false);
  const { saved, flash } = useSaveFlash();

  function toggleRole(roleId: string) {
    setSelectedRoles((prev) =>
      prev.includes(roleId) ? prev.filter((id) => id !== roleId) : [...prev, roleId],
    );
  }

  function toggleChannel(channelId: string) {
    setSelectedChannels((prev) =>
      prev.includes(channelId) ? prev.filter((id) => id !== channelId) : [...prev, channelId],
    );
  }

  async function handleSave() {
    setSaving(true);
    const mappings = [
      ...selectedRoles.map((roleId) => ({ roleId, channelId: null })),
      ...selectedChannels.map((channelId) => ({ roleId: null, channelId })),
    ];
    await onSave(answer.id, mappings);
    setSaving(false);
    flash();
  }

  return (
    <div className="rounded-lg bg-field border border-border p-2 space-y-2">
      {/* Roles */}
      {roles.length > 0 && (
        <div>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Assigns Roles</span>
          <div className="flex flex-wrap gap-1 mt-1">
            {roles.map((role) => (
              <button
                key={role.id}
                onClick={() => toggleRole(role.id)}
                className={cn(
                  "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] border transition-colors",
                  selectedRoles.includes(role.id)
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted hover:border-border-light",
                )}
              >
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: role.color ?? "var(--color-muted)" }}
                />
                {role.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Channels */}
      {channels.length > 0 && (
        <div>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Unlocks Channels</span>
          <div className="flex flex-wrap gap-1 mt-1">
            {channels.map((ch) => (
              <button
                key={ch.id}
                onClick={() => toggleChannel(ch.id)}
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] border transition-colors",
                  selectedChannels.includes(ch.id)
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted hover:border-border-light",
                )}
              >
                {ch.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button variant="accent" size="sm" onClick={handleSave} disabled={saving}>
          {saving ? <Spinner size="sm" /> : "Save Mappings"}
        </Button>
        <SavedBadge visible={saved} />
      </div>
    </div>
  );
}

// ── Todo Section ────────────────────────────────────────────────────

function TodoSection({
  todoItems,
  onAdd,
  onEdit,
  onRemove,
}: {
  todoItems: Array<{ id: string; title: string; description: string | null; linkChannelId: string | null; position: number }>;
  onAdd: (p: { title: string; description?: string; linkChannelId?: string }) => Promise<void>;
  onEdit: (id: string, p: { title?: string; description?: string | null; linkChannelId?: string | null }) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [newTitle, setNewTitle] = useState("");

  async function handleAdd() {
    if (!newTitle.trim()) return;
    await onAdd({ title: newTitle.trim() });
    setNewTitle("");
  }

  const sorted = [...todoItems].sort((a, b) => a.position - b.position);

  return (
    <div className="space-y-2">
      {sorted.map((item) => (
        <div
          key={item.id}
          className="flex items-start gap-2 card-glass rounded-xl px-3 py-2"
        >
          <ListChecks size={14} className="mt-0.5 shrink-0 text-primary" />
          <div className="flex-1 min-w-0">
            <input
              value={item.title}
              onChange={(e) => onEdit(item.id, { title: e.target.value })}
              className="w-full bg-transparent text-sm text-heading focus:outline-none"
            />
            <input
              value={item.description ?? ""}
              onChange={(e) => onEdit(item.id, { description: e.target.value || null })}
              placeholder="Optional description..."
              className="w-full bg-transparent text-[11px] text-muted placeholder-muted/50 focus:outline-none"
            />
          </div>
          <button
            onClick={() => onRemove(item.id)}
            className="text-muted hover:text-red-400 transition-colors shrink-0"
          >
            <Trash2 size={12} />
          </button>
        </div>
      ))}

      <div className="flex gap-2">
        <input
          type="text"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="e.g. Say hello in #chat"
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          className="flex-1 rounded-xl bg-field border border-border px-3 py-1.5 text-sm text-heading placeholder-muted focus:border-primary focus:outline-none transition-colors"
        />
        <Button variant="accent" size="md" onClick={handleAdd} disabled={!newTitle.trim()}>
          <Plus size={14} className="mr-1" />
          Add
        </Button>
      </div>
    </div>
  );
}
