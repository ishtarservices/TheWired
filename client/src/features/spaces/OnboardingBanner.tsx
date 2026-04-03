import { useState } from "react";
import { Sparkles, X } from "lucide-react";
import { useAppSelector } from "../../store/hooks";
import { OnboardingFlow } from "./OnboardingFlow";

interface OnboardingBannerProps {
  spaceId: string;
  spaceName: string;
  spacePicture?: string;
}

export function OnboardingBanner({ spaceId, spaceName, spacePicture }: OnboardingBannerProps) {
  const isPending = useAppSelector(
    (s) => s.spaceConfig.onboardingPending[spaceId] ?? false,
  );
  const [dismissed, setDismissed] = useState(false);
  const [showFlow, setShowFlow] = useState(false);

  if (!isPending || dismissed) return null;

  return (
    <>
      <div className="flex items-center gap-3 rounded-xl bg-primary/5 border border-primary/10 px-4 py-2.5 mx-4 mt-2">
        <Sparkles size={16} className="shrink-0 text-primary" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-heading">Customize your experience</p>
          <p className="text-[10px] text-muted">
            Complete onboarding to unlock all channels and personalize your space.
          </p>
        </div>
        <button
          onClick={() => setShowFlow(true)}
          className="shrink-0 rounded-lg bg-primary px-3 py-1 text-xs font-medium text-white hover:bg-primary/90 transition-colors"
        >
          Customize
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="shrink-0 text-muted hover:text-heading transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      {showFlow && (
        <OnboardingFlow
          open
          onClose={() => setShowFlow(false)}
          spaceId={spaceId}
          spaceName={spaceName}
          spacePicture={spacePicture}
        />
      )}
    </>
  );
}
