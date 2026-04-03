import { useState, useEffect } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Modal } from "../../components/ui/Modal";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Spinner";
import { Avatar } from "../../components/ui/Avatar";
import { fetchOnboardingPreview, submitOnboarding } from "../../lib/api/onboarding";
import { useAppDispatch } from "../../store/hooks";
import { setOnboardingPending } from "../../store/slices/spaceConfigSlice";
import type { OnboardingPreview } from "@/types/space";

interface OnboardingFlowProps {
  open: boolean;
  onClose: () => void;
  spaceId: string;
  spaceName: string;
  spacePicture?: string | null;
  /** Called after successful submission so parent can refresh permissions */
  onComplete?: () => void;
}

type Step = "loading" | "welcome" | "question" | "confirm" | "submitting" | "done";

export function OnboardingFlow({
  open,
  onClose,
  spaceId,
  spaceName,
  spacePicture,
  onComplete,
}: OnboardingFlowProps) {
  const dispatch = useAppDispatch();
  const [step, setStep] = useState<Step>("loading");
  const [preview, setPreview] = useState<OnboardingPreview | null>(null);
  const [currentQuestionIdx, setCurrentQuestionIdx] = useState(0);
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);

  // Load onboarding preview
  useEffect(() => {
    if (!open || !spaceId) return;
    let cancelled = false;

    async function load() {
      try {
        const res = await fetchOnboardingPreview(spaceId);
        if (cancelled) return;

        if (!res.data || res.data.questions.length === 0) {
          // No onboarding configured — just close
          onComplete?.();
          onClose();
          return;
        }

        setPreview(res.data);
        setStep(res.data.welcomeMessage || res.data.welcomeImage ? "welcome" : "question");
      } catch {
        if (!cancelled) {
          onComplete?.();
          onClose();
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [open, spaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const questions = preview?.questions ?? [];
  const currentQuestion = questions[currentQuestionIdx];
  const currentSelections = currentQuestion ? (selections[currentQuestion.id] ?? []) : [];

  function toggleAnswer(questionId: string, answerId: string, multiple: boolean) {
    setSelections((prev) => {
      const current = prev[questionId] ?? [];
      if (multiple) {
        return {
          ...prev,
          [questionId]: current.includes(answerId)
            ? current.filter((id) => id !== answerId)
            : [...current, answerId],
        };
      }
      // Single select — toggle or replace
      return {
        ...prev,
        [questionId]: current.includes(answerId) ? [] : [answerId],
      };
    });
  }

  function canAdvance(): boolean {
    if (!currentQuestion) return true;
    if (currentQuestion.required && currentSelections.length === 0) return false;
    return true;
  }

  function handleNext() {
    if (currentQuestionIdx < questions.length - 1) {
      setCurrentQuestionIdx((i) => i + 1);
    } else {
      setStep("confirm");
    }
  }

  function handleBack() {
    if (step === "confirm") {
      setStep("question");
      setCurrentQuestionIdx(questions.length - 1);
    } else if (currentQuestionIdx > 0) {
      setCurrentQuestionIdx((i) => i - 1);
    } else if (preview?.welcomeMessage || preview?.welcomeImage) {
      setStep("welcome");
    }
  }

  async function handleSubmit() {
    setStep("submitting");
    setError(null);

    try {
      const answers = Object.entries(selections)
        .filter(([, ids]) => ids.length > 0)
        .map(([questionId, answerIds]) => ({ questionId, answerIds }));

      await submitOnboarding(spaceId, answers);
      setStep("done");
      dispatch(setOnboardingPending({ spaceId, pending: false }));
      onComplete?.();

      // Auto-close after brief delay
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err: any) {
      setError(err.message ?? "Failed to submit onboarding");
      setStep("confirm");
    }
  }

  function handleSkip() {
    // Allow user to skip onboarding and enter space with limited channels
    onClose();
  }

  return (
    <Modal open={open} onClose={handleSkip}>
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl card-glass shadow-2xl relative">
        {/* Close / Skip button (always visible except during submit/done) */}
        {step !== "submitting" && step !== "done" && step !== "loading" && (
          <button
            onClick={handleSkip}
            className="absolute top-4 right-4 z-10 rounded-full p-1.5 text-muted hover:bg-card-hover hover:text-heading transition-colors"
            title="Skip for now"
          >
            <X size={16} />
          </button>
        )}

        {/* Loading */}
        {step === "loading" && (
          <div className="flex items-center justify-center py-16">
            <Spinner size="lg" />
          </div>
        )}

        {/* Welcome */}
        {step === "welcome" && preview && (
          <div className="p-8 space-y-6">
            {preview.welcomeImage && (
              <img
                src={preview.welcomeImage}
                alt="Welcome"
                className="w-full h-40 object-cover rounded-xl"
              />
            )}

            <div className="text-center space-y-3">
              <Avatar
                src={spacePicture ?? undefined}
                alt={spaceName}
                size="lg"
              />
              <h2 className="text-xl font-bold text-heading">
                Welcome to {spaceName}!
              </h2>
              {preview.welcomeMessage && (
                <p className="text-sm text-body leading-relaxed whitespace-pre-wrap">
                  {preview.welcomeMessage}
                </p>
              )}
            </div>

            <Button
              variant="primary"
              size="lg"
              className="w-full"
              onClick={() => { setStep("question"); setCurrentQuestionIdx(0); }}
            >
              Get Started
              <ArrowRight size={16} className="ml-2" />
            </Button>

            <button
              onClick={handleSkip}
              className="w-full text-center text-xs text-muted hover:text-soft transition-colors"
            >
              Skip for now
            </button>
          </div>
        )}

        {/* Question */}
        {step === "question" && currentQuestion && (
          <div className="p-8 space-y-6">
            {/* Progress */}
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1 rounded-full bg-border overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-300"
                  style={{ width: `${((currentQuestionIdx + 1) / questions.length) * 100}%` }}
                />
              </div>
              <span className="text-[10px] text-muted shrink-0">
                {currentQuestionIdx + 1}/{questions.length}
              </span>
            </div>

            {/* Question text */}
            <div>
              <h3 className="text-lg font-bold text-heading">
                {currentQuestion.title}
                {currentQuestion.required && (
                  <span className="text-red-400 ml-1">*</span>
                )}
              </h3>
              {currentQuestion.description && (
                <p className="mt-1 text-sm text-muted">{currentQuestion.description}</p>
              )}
              <p className="mt-1 text-[10px] text-muted">
                {currentQuestion.multiple ? "Select all that apply" : "Select one"}
              </p>
            </div>

            {/* Answer options */}
            <div className="space-y-2">
              {currentQuestion.answers
                .sort((a, b) => a.position - b.position)
                .map((answer) => {
                  const selected = currentSelections.includes(answer.id);
                  return (
                    <button
                      key={answer.id}
                      onClick={() => toggleAnswer(currentQuestion.id, answer.id, currentQuestion.multiple)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all",
                        selected
                          ? "border-primary bg-primary/10 text-heading"
                          : "border-border bg-surface/50 text-body hover:border-border-light hover:bg-surface-hover",
                      )}
                    >
                      {/* Selection indicator */}
                      <div
                        className={cn(
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                          selected
                            ? "border-primary bg-primary"
                            : "border-border",
                          currentQuestion.multiple && "rounded-md",
                        )}
                      >
                        {selected && <Check size={12} className="text-white" />}
                      </div>

                      {/* Content */}
                      {answer.emoji && (
                        <span className="text-lg">{answer.emoji}</span>
                      )}
                      <span className="text-sm font-medium">{answer.label}</span>
                    </button>
                  );
                })}
            </div>

            {/* Navigation */}
            <div className="flex justify-between">
              <Button
                variant="ghost"
                size="md"
                onClick={handleBack}
                disabled={currentQuestionIdx === 0 && !preview?.welcomeMessage && !preview?.welcomeImage}
              >
                <ArrowLeft size={14} className="mr-1" />
                Back
              </Button>

              <div className="flex gap-2">
                {!currentQuestion.required && currentSelections.length === 0 && (
                  <Button variant="ghost" size="md" onClick={handleNext}>
                    Skip
                  </Button>
                )}
                <Button
                  variant="primary"
                  size="md"
                  onClick={handleNext}
                  disabled={!canAdvance()}
                >
                  {currentQuestionIdx < questions.length - 1 ? "Next" : "Review"}
                  <ChevronRight size={14} className="ml-1" />
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Confirmation */}
        {step === "confirm" && (
          <div className="p-8 space-y-6">
            <h3 className="text-lg font-bold text-heading">Review Your Selections</h3>

            <div className="space-y-3">
              {questions.map((q) => {
                const selected = selections[q.id] ?? [];
                if (selected.length === 0) return null;

                const answerLabels = selected
                  .map((id) => q.answers.find((a) => a.id === id))
                  .filter(Boolean)
                  .map((a) => `${a!.emoji ? a!.emoji + " " : ""}${a!.label}`);

                return (
                  <div key={q.id} className="card-glass rounded-xl p-3">
                    <div className="text-xs font-medium text-muted">{q.title}</div>
                    <div className="mt-1 text-sm text-heading">
                      {answerLabels.join(", ")}
                    </div>
                  </div>
                );
              })}
            </div>

            {error && (
              <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-300">
                {error}
              </div>
            )}

            <div className="flex justify-between">
              <Button variant="ghost" size="md" onClick={handleBack}>
                <ArrowLeft size={14} className="mr-1" />
                Back
              </Button>
              <Button variant="primary" size="md" onClick={handleSubmit}>
                Finish
                <Check size={14} className="ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* Submitting */}
        {step === "submitting" && (
          <div className="flex flex-col items-center py-16">
            <Spinner size="lg" />
            <p className="mt-3 text-sm text-soft">Setting up your experience...</p>
          </div>
        )}

        {/* Done */}
        {step === "done" && (
          <div className="flex flex-col items-center py-16">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10 text-green-400">
              <Check size={24} />
            </div>
            <p className="mt-3 text-sm font-medium text-heading">
              Welcome to {spaceName}!
            </p>
            <p className="mt-1 text-xs text-muted">You're all set</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
