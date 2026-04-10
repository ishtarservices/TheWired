import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, HelpCircle, Copy, Check, ChevronRight, ChevronLeft, Key } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { npubEncode } from "nostr-tools/nip19";
import { cn } from "@/lib/utils";
import { Button } from "../../components/ui/Button";
import { ShimmerButton } from "@/components/ui/ShimmerButton";
import { Spinner } from "../../components/ui/Spinner";
import { ImageUpload } from "../../components/ui/ImageUpload";
import { TextAnimate } from "../../components/ui/TextAnimate";
import { Avatar } from "../../components/ui/Avatar";
import { useAppSelector, useAppDispatch } from "../../store/hooks";
import { useAutoResize } from "../../hooks/useAutoResize";
import { buildProfileEvent } from "../../lib/nostr/eventBuilder";
import { signAndPublish } from "../../lib/nostr/publish";
import {
  setShowProfileWizard,
  setProfileWizardCompleted,
  setShowAppTour,
} from "./onboardingSlice";
import { persistOnboardingFlag } from "./onboardingPersistence";
import type { Kind0Profile } from "../../types/profile";
import { checkNip05Username, registerNip05 } from "../../lib/api/nip05";
import { sanitizeNip05Username, sanitizeNip05Input } from "../../lib/nip05Utils";

type Step = "welcome" | "basic" | "media" | "advanced" | "complete";

const STEPS: Step[] = ["welcome", "basic", "media", "advanced", "complete"];

const HELP_TEXT: Record<string, { label: string; help: string }> = {
  name: {
    label: "Username",
    help: "Your unique handle on Nostr. Like @username on other platforms. Keep it short and memorable.",
  },
  display_name: {
    label: "Display Name",
    help: "The name people see. Can be your real name, artist name, or anything you like.",
  },
  about: {
    label: "About",
    help: "A short bio. Tell people what you're about.",
  },
  nip05: {
    label: "NIP-05 Identifier",
    help: "A verification identifier (you@domain.com) that proves you own a domain. Adds credibility. You can set this up later.",
  },
  lud16: {
    label: "Lightning Address",
    help: "For receiving Bitcoin tips (you@wallet.com). If you don't have one, skip this.",
  },
  website: {
    label: "Website",
    help: "Your personal website or link.",
  },
};

function HelpTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);

  return (
    <span className="relative inline-flex ml-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-muted hover:text-primary transition-colors"
      >
        <HelpCircle size={13} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            className="absolute left-0 top-full z-10 mt-1.5 w-56 rounded-lg border border-border bg-panel p-2.5 text-xs text-soft shadow-lg"
          >
            {text}
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  );
}

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center justify-center gap-1.5">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={cn(
            "h-1.5 rounded-full transition-all duration-300",
            i === current
              ? "w-6 bg-primary"
              : i < current
                ? "w-1.5 bg-primary/40"
                : "w-1.5 bg-faint",
          )}
        />
      ))}
    </div>
  );
}

export function ProfileWizard() {
  const dispatch = useAppDispatch();
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const existingProfile = useAppSelector((s) => s.identity.profile);
  const profileCreatedAt = useAppSelector((s) => s.identity.profileCreatedAt);
  const loginMethod = useAppSelector((s) => s.onboarding.loginMethod);

  // For import/nip07, skip to tour offer if profile already exists
  const shouldSkipToComplete =
    loginMethod !== "generate" && !!existingProfile?.name;

  const [step, setStep] = useState<Step>(
    shouldSkipToComplete ? "complete" : "welcome",
  );
  const [form, setForm] = useState<Kind0Profile>({
    name: existingProfile?.name ?? "",
    display_name: existingProfile?.display_name ?? "",
    about: existingProfile?.about ?? "",
    picture: existingProfile?.picture ?? "",
    banner: existingProfile?.banner ?? "",
    nip05: existingProfile?.nip05 ?? "",
    lud16: existingProfile?.lud16 ?? "",
    website: existingProfile?.website ?? "",
  });

  // Sync form with profile data arriving from relays (covers the race where
  // the wizard mounts before relay data loads, preventing empty-profile publish)
  const [formSyncedAt, setFormSyncedAt] = useState(0);
  useEffect(() => {
    if (existingProfile && profileCreatedAt > formSyncedAt) {
      setForm((prev) => ({
        name: existingProfile.name ?? prev.name ?? "",
        display_name: existingProfile.display_name ?? prev.display_name ?? "",
        about: existingProfile.about ?? prev.about ?? "",
        picture: existingProfile.picture ?? prev.picture ?? "",
        banner: existingProfile.banner ?? prev.banner ?? "",
        nip05: existingProfile.nip05 ?? prev.nip05 ?? "",
        lud16: existingProfile.lud16 ?? prev.lud16 ?? "",
        website: existingProfile.website ?? prev.website ?? "",
      }));
      setFormSyncedAt(profileCreatedAt);
    }
  }, [existingProfile, profileCreatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  // Track whether user has manually edited NIP-05
  const [nip05Touched, setNip05Touched] = useState(!!existingProfile?.nip05);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(shouldSkipToComplete);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showSkipConfirm, setShowSkipConfirm] = useState(false);
  const [nip05Status, setNip05Status] = useState<"idle" | "checking" | "available" | "taken">("idle");
  const nip05CheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const aboutRef = useRef<HTMLTextAreaElement>(null);
  useAutoResize(aboutRef, form.about ?? "", 120);

  const npub = useMemo(
    () => (pubkey ? npubEncode(pubkey) : ""),
    [pubkey],
  );

  const stepIndex = STEPS.indexOf(step);

  const scheduleNip05Check = useCallback((nip05Value: string) => {
    if (nip05CheckTimer.current) clearTimeout(nip05CheckTimer.current);
    const match = nip05Value.match(/^(.+)@thewired\.app$/i);
    if (!match || !match[1]) {
      setNip05Status("idle");
      return;
    }
    const username = match[1].toLowerCase();
    if (username.length === 0) { setNip05Status("idle"); return; }
    setNip05Status("checking");
    nip05CheckTimer.current = setTimeout(async () => {
      try {
        const res = await checkNip05Username(username);
        setNip05Status(res.data.available ? "available" : "taken");
      } catch {
        setNip05Status("idle");
      }
    }, 500);
  }, []);

  const updateField = (field: keyof Kind0Profile, value: string) => {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      // Auto-sync NIP-05 with username if user hasn't manually edited it
      if (field === "name" && !nip05Touched) {
        const sanitized = sanitizeNip05Username(value);
        next.nip05 = sanitized ? `${sanitized}@thewired.app` : "";
        scheduleNip05Check(next.nip05 ?? "");
      }
      if (field === "nip05") {
        const sanitized = sanitizeNip05Input(value);
        next.nip05 = sanitized;
        setNip05Touched(true);
        scheduleNip05Check(sanitized);
      }
      return next;
    });
  };

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(npub);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [npub]);

  const handleSaveProfile = async () => {
    if (!pubkey) return;
    setSaving(true);
    setError(null);
    try {
      // Register NIP-05 on backend if it's a @thewired.app identifier
      const nip05Val = form.nip05?.trim() ?? "";
      const nip05Match = nip05Val.match(/^(.+)@thewired\.app$/i);
      if (nip05Match?.[1]) {
        try {
          await registerNip05(nip05Match[1]);
        } catch (e: unknown) {
          // If this pubkey already owns a NIP-05, that's fine — continue
          const code = (e as { code?: string }).code ?? "";
          if (code !== "ALREADY_REGISTERED") {
            setError(code === "USERNAME_TAKEN"
              ? "That username is already taken. Choose a different one."
              : `NIP-05 registration failed: ${e instanceof Error ? e.message : String(e)}`);
            setSaving(false);
            return;
          }
        }
      }

      const unsigned = buildProfileEvent(pubkey, form);
      await signAndPublish(unsigned);
      setSaved(true);
      dispatch(setProfileWizardCompleted(true));
      persistOnboardingFlag("profileWizardCompleted", true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  const handleClose = useCallback(() => {
    dispatch(setProfileWizardCompleted(true));
    persistOnboardingFlag("profileWizardCompleted", true);
    dispatch(setShowProfileWizard(false));
  }, [dispatch]);

  const handleStartTour = useCallback(() => {
    dispatch(setShowProfileWizard(false));
    dispatch(setShowAppTour(true));
  }, [dispatch]);

  const goNext = () => {
    const idx = STEPS.indexOf(step);
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1]);
  };

  const goBack = () => {
    const idx = STEPS.indexOf(step);
    if (idx > 0) setStep(STEPS[idx - 1]);
  };

  // Auto-save when reaching complete step (if not already saved).
  // Skip auto-publish if the form is entirely empty — this prevents wiping
  // an existing profile when relay data hasn't arrived yet.
  const formHasContent = !!(form.name || form.display_name || form.about || form.picture || form.banner);
  useEffect(() => {
    if (step === "complete" && !saved && !saving && formHasContent) {
      handleSaveProfile();
    }
  }, [step, formHasContent]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!pubkey) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md">
      {/* Skip confirm overlay */}
      <AnimatePresence>
        {showSkipConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[60] flex items-center justify-center bg-black/50"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="rounded-xl border border-border bg-panel p-6 text-center max-w-xs"
            >
              <p className="text-sm text-heading font-medium mb-1">
                Skip profile setup?
              </p>
              <p className="text-xs text-muted mb-4">
                You can edit your profile anytime in Settings.
              </p>
              <div className="flex gap-2 justify-center">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowSkipConfirm(false)}
                >
                  Continue Setup
                </Button>
                <Button variant="secondary" size="sm" onClick={handleClose}>
                  Skip
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main wizard card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative w-full max-w-md rounded-2xl border-gradient card-glass p-8 mx-4"
      >
        {/* Close button */}
        {step !== "complete" && (
          <button
            onClick={() => setShowSkipConfirm(true)}
            className="absolute top-4 right-4 text-muted hover:text-heading transition-colors"
          >
            <X size={16} />
          </button>
        )}

        {/* Step indicator */}
        <div className="mb-6">
          <StepIndicator current={stepIndex} total={STEPS.length} />
        </div>

        {/* Step content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
          >
            {step === "welcome" && (
              <WelcomeStep
                npub={npub}
                copied={copied}
                onCopy={handleCopy}
                onNext={goNext}
              />
            )}
            {step === "basic" && (
              <BasicInfoStep
                form={form}
                aboutRef={aboutRef}
                onUpdate={updateField}
                onNext={goNext}
                onBack={goBack}
              />
            )}
            {step === "media" && (
              <MediaStep
                form={form}
                onUpdate={updateField}
                onNext={goNext}
                onBack={goBack}
              />
            )}
            {step === "advanced" && (
              <AdvancedStep
                form={form}
                nip05Status={nip05Status}
                onUpdate={updateField}
                onNext={goNext}
                onBack={goBack}
              />
            )}
            {step === "complete" && (
              <CompleteStep
                saving={saving}
                saved={saved}
                error={error}
                onStartTour={handleStartTour}
                onClose={handleClose}
                onRetry={handleSaveProfile}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </motion.div>
    </div>,
    document.body,
  );
}

/* ── Step Components ── */

function WelcomeStep({
  npub,
  copied,
  onCopy,
  onNext,
}: {
  npub: string;
  copied: boolean;
  onCopy: () => void;
  onNext: () => void;
}) {
  return (
    <div className="text-center">
      <div className="mb-5 flex justify-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
          <Key size={28} className="text-primary-soft" />
        </div>
      </div>
      <TextAnimate
        as="h2"
        animation="blurInUp"
        by="word"
        className="text-xl font-bold text-gradient-accent tracking-wide mb-3"
        startOnView={false}
      >
        Welcome to The Wired
      </TextAnimate>
      <p className="text-sm text-soft mb-5 leading-relaxed">
        Your identity is a cryptographic keypair.
        You own it — no company controls it.
      </p>

      {/* npub display */}
      <div className="flex items-center gap-2 rounded-xl bg-field border border-border px-3 py-2 mb-6">
        <span className="flex-1 truncate text-xs text-muted font-mono">
          {npub}
        </span>
        <button
          onClick={onCopy}
          className="shrink-0 text-muted hover:text-heading transition-colors"
          title="Copy public key"
        >
          {copied ? (
            <Check size={14} className="text-green-400" />
          ) : (
            <Copy size={14} />
          )}
        </button>
      </div>

      <ShimmerButton className="w-full gap-2" onClick={onNext}>
        Set Up Your Profile
        <ChevronRight size={16} />
      </ShimmerButton>
    </div>
  );
}

function BasicInfoStep({
  form,
  aboutRef,
  onUpdate,
  onNext,
  onBack,
}: {
  form: Kind0Profile;
  aboutRef: React.RefObject<HTMLTextAreaElement | null>;
  onUpdate: (field: keyof Kind0Profile, value: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <div>
      <h2 className="text-lg font-bold text-gradient-accent tracking-wide mb-1">
        Basic Info
      </h2>
      <p className="text-xs text-muted mb-5">
        Tell people who you are
      </p>

      <div className="space-y-3">
        {(["name", "display_name", "about"] as const).map((key) => (
          <div key={key}>
            <label className="mb-1 flex items-center text-xs text-soft">
              {HELP_TEXT[key].label}
              <HelpTooltip text={HELP_TEXT[key].help} />
            </label>
            {key === "about" ? (
              <textarea
                ref={aboutRef}
                value={form[key] ?? ""}
                onChange={(e) => onUpdate(key, e.target.value)}
                placeholder="Tell people about yourself..."
                className="w-full resize-none overflow-hidden rounded-xl border border-border bg-field px-3 py-2 text-sm text-heading placeholder-muted focus:border-primary focus:outline-none transition-colors"
                rows={2}
              />
            ) : (
              <input
                type="text"
                value={form[key] ?? ""}
                onChange={(e) => onUpdate(key, e.target.value)}
                placeholder={
                  key === "name" ? "username" : "Display Name"
                }
                className="w-full rounded-xl border border-border bg-field px-3 py-2 text-sm text-heading placeholder-muted focus:border-primary focus:outline-none transition-colors"
              />
            )}
          </div>
        ))}
      </div>

      <div className="mt-6 flex justify-between">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft size={14} />
          Back
        </Button>
        <Button onClick={onNext} className="gap-1">
          Next
          <ChevronRight size={14} />
        </Button>
      </div>
    </div>
  );
}

function MediaStep({
  form,
  onUpdate,
  onNext,
  onBack,
}: {
  form: Kind0Profile;
  onUpdate: (field: keyof Kind0Profile, value: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <div>
      <h2 className="text-lg font-bold text-gradient-accent tracking-wide mb-1">
        Avatar & Banner
      </h2>
      <p className="text-xs text-muted mb-5">
        Add a face and a banner to your profile
      </p>

      <div className="space-y-4">
        <ImageUpload
          value={form.picture ?? ""}
          onChange={(url) => onUpdate("picture", url)}
          label="Avatar"
          placeholder="Drop avatar image or click to upload"
          shape="circle"
        />
        <ImageUpload
          value={form.banner ?? ""}
          onChange={(url) => onUpdate("banner", url)}
          label="Banner"
          placeholder="Drop banner image or click to upload"
          shape="banner"
        />
      </div>

      {/* Live preview */}
      {(form.name || form.display_name) && (
        <div className="mt-5 flex items-center gap-3 rounded-xl border border-border bg-panel/50 p-3">
          <Avatar
            src={form.picture || undefined}
            size="md"
          />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-heading truncate">
              {form.display_name || form.name}
            </div>
            {form.about && (
              <div className="text-xs text-muted truncate">{form.about}</div>
            )}
          </div>
        </div>
      )}

      <div className="mt-6 flex justify-between">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft size={14} />
          Back
        </Button>
        <Button onClick={onNext} className="gap-1">
          Next
          <ChevronRight size={14} />
        </Button>
      </div>
    </div>
  );
}

function AdvancedStep({
  form,
  nip05Status,
  onUpdate,
  onNext,
  onBack,
}: {
  form: Kind0Profile;
  nip05Status: "idle" | "checking" | "available" | "taken";
  onUpdate: (field: keyof Kind0Profile, value: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <div>
      <h2 className="text-lg font-bold text-gradient-accent tracking-wide mb-1">
        Optional Details
      </h2>
      <p className="text-xs text-muted mb-5">
        You can set these up later in Settings
      </p>

      <div className="space-y-3">
        {(["nip05", "lud16", "website"] as const).map((key) => (
          <div key={key}>
            <label className="mb-1 flex items-center text-xs text-soft">
              {HELP_TEXT[key].label}
              <HelpTooltip text={HELP_TEXT[key].help} />
            </label>
            <input
              type="text"
              value={form[key] ?? ""}
              onChange={(e) => onUpdate(key, e.target.value)}
              placeholder={
                key === "nip05"
                  ? "username@thewired.app"
                  : key === "lud16"
                    ? "you@wallet.com"
                    : "https://yoursite.com"
              }
              className={cn(
                "w-full rounded-xl border bg-field px-3 py-2 text-sm text-heading placeholder-muted focus:outline-none transition-colors",
                key === "nip05" && nip05Status === "taken"
                  ? "border-red-500/50 focus:border-red-500"
                  : key === "nip05" && nip05Status === "available"
                    ? "border-green-500/50 focus:border-green-500"
                    : "border-border focus:border-primary",
              )}
            />
            {key === "nip05" && nip05Status === "checking" && (
              <p className="mt-1 text-[11px] text-muted">Checking availability...</p>
            )}
            {key === "nip05" && nip05Status === "available" && (
              <p className="mt-1 text-[11px] text-green-400">Username available</p>
            )}
            {key === "nip05" && nip05Status === "taken" && (
              <p className="mt-1 text-[11px] text-red-400">Username already taken</p>
            )}
          </div>
        ))}
      </div>

      <div className="mt-6 flex justify-between">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft size={14} />
          Back
        </Button>
        <ShimmerButton className="gap-1 text-sm px-5 py-2" onClick={onNext}>
          Complete Profile
          <ChevronRight size={16} />
        </ShimmerButton>
      </div>
    </div>
  );
}

function CompleteStep({
  saving,
  saved,
  error,
  onStartTour,
  onClose,
  onRetry,
}: {
  saving: boolean;
  saved: boolean;
  error: string | null;
  onStartTour: () => void;
  onClose: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="text-center">
      {saving && (
        <>
          <div className="mb-4 flex justify-center">
            <Spinner size="lg" />
          </div>
          <p className="text-sm text-soft">Publishing your profile...</p>
        </>
      )}

      {error && (
        <>
          <p className="text-sm text-red-400 mb-3">{error}</p>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </>
      )}

      {saved && !error && (
        <>
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", damping: 15, stiffness: 300 }}
            className="mb-4 flex justify-center"
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-500/10">
              <Check size={28} className="text-green-400" />
            </div>
          </motion.div>

          <TextAnimate
            as="h2"
            animation="blurInUp"
            by="word"
            className="text-lg font-bold text-heading mb-2"
            startOnView={false}
          >
            Your profile is live!
          </TextAnimate>

          <p className="text-sm text-soft mb-6">
            Want a quick tour of The Wired?
          </p>

          <div className="space-y-2">
            <ShimmerButton className="w-full gap-2" onClick={onStartTour}>
              Show Me Around
              <ChevronRight size={16} />
            </ShimmerButton>
            <Button
              variant="ghost"
              className="w-full"
              onClick={onClose}
            >
              I'll Explore on My Own
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
