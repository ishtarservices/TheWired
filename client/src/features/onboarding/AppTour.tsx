import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, X, Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";
import { Button } from "../../components/ui/Button";
import { ShimmerButton } from "@/components/ui/ShimmerButton";
import { TextAnimate } from "../../components/ui/TextAnimate";
import { useAppDispatch } from "../../store/hooks";
import { setSidebarMode } from "../../store/slices/uiSlice";
import { setActiveSpace } from "../../store/slices/spacesSlice";
import { setAppTourCompleted, setTourStepIndex } from "./onboardingSlice";
import { persistOnboardingFlag } from "./onboardingPersistence";
import { TOUR_STEPS, type TourStep } from "./tourSteps";
import { FRIENDS_FEED_ID } from "../friends/friendsFeedConstants";

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function getTargetRect(target: string): SpotlightRect | null {
  const el = document.querySelector(`[data-tour="${target}"]`);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const padding = 6;
  return {
    top: rect.top - padding,
    left: rect.left - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
  };
}

function getCardStyle(
  spotlight: SpotlightRect | null,
  position: TourStep["cardPosition"],
): React.CSSProperties {
  if (!spotlight || position === "center") {
    return {
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
    };
  }

  if (position === "right") {
    return {
      top: Math.max(spotlight.top, 16),
      left: spotlight.left + spotlight.width + 16,
    };
  }

  // bottom
  return {
    top: spotlight.top + spotlight.height + 16,
    left: Math.max(spotlight.left, 16),
  };
}

export function AppTour() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [spotlight, setSpotlight] = useState<SpotlightRect | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [showComplete, setShowComplete] = useState(false);
  const rafRef = useRef<number>(0);

  const currentStep = TOUR_STEPS[currentIndex];
  const isLast = currentIndex === TOUR_STEPS.length - 1;

  const executeBeforeShow = useCallback(
    (step: TourStep) => {
      if (step.beforeShow.sidebarMode) {
        dispatch(setSidebarMode(step.beforeShow.sidebarMode));
      }
      if (step.beforeShow.activateFriendsFeed) {
        dispatch(setActiveSpace(FRIENDS_FEED_ID));
      }
      if (step.beforeShow.route) {
        navigate(step.beforeShow.route);
      }
    },
    [dispatch, navigate],
  );

  const updateSpotlight = useCallback(() => {
    if (showComplete) return;
    const rect = getTargetRect(TOUR_STEPS[currentIndex].target);
    setSpotlight(rect);
  }, [currentIndex, showComplete]);

  // Execute beforeShow and update spotlight for current step
  useEffect(() => {
    setTransitioning(true);
    executeBeforeShow(TOUR_STEPS[currentIndex]);

    // Wait for DOM to update after navigation
    const timeout = setTimeout(() => {
      updateSpotlight();
      setTransitioning(false);
    }, 350);

    return () => clearTimeout(timeout);
  }, [currentIndex, executeBeforeShow, updateSpotlight]);

  // Recalculate spotlight on resize
  useEffect(() => {
    const handleResize = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(updateSpotlight);
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(rafRef.current);
    };
  }, [updateSpotlight]);

  const handleNext = () => {
    if (isLast) {
      setShowComplete(true);
      return;
    }
    const next = currentIndex + 1;
    setCurrentIndex(next);
    dispatch(setTourStepIndex(next));
  };

  const handleBack = () => {
    if (currentIndex > 0) {
      const prev = currentIndex - 1;
      setCurrentIndex(prev);
      dispatch(setTourStepIndex(prev));
    }
  };

  const handleClose = useCallback(() => {
    dispatch(setAppTourCompleted(true));
    persistOnboardingFlag("appTourCompleted", true);
    // Navigate home
    dispatch(setSidebarMode("spaces"));
    navigate("/");
  }, [dispatch, navigate]);

  const handleSkip = useCallback(() => {
    dispatch(setAppTourCompleted(true));
    persistOnboardingFlag("appTourCompleted", true);
  }, [dispatch]);

  return createPortal(
    <div className="fixed inset-0 z-[60]">
      {/* Backdrop with spotlight hole */}
      <SpotlightOverlay spotlight={showComplete ? null : spotlight} />

      {/* Tour card */}
      <AnimatePresence mode="wait">
        {showComplete ? (
          <motion.div
            key="complete"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed inset-0 flex items-center justify-center"
          >
            <div className="card-glass border-gradient rounded-2xl p-8 max-w-sm text-center mx-4">
              <motion.div
                initial={{ scale: 0.8 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", damping: 12, stiffness: 200 }}
                className="mb-4 flex justify-center"
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 animate-pulse-glow">
                  <Sparkles size={28} className="text-primary" />
                </div>
              </motion.div>

              <TextAnimate
                as="h2"
                animation="blurInUp"
                by="word"
                className="text-lg font-bold text-heading mb-2"
                startOnView={false}
              >
                You're all set!
              </TextAnimate>
              <p className="text-sm text-soft mb-6">
                Explore, connect, and make The Wired yours.
              </p>
              <ShimmerButton className="w-full gap-2" onClick={handleClose}>
                Start Exploring
                <ChevronRight size={16} />
              </ShimmerButton>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key={currentStep.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: transitioning ? 0 : 1, y: transitioning ? 10 : 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="fixed w-[340px] max-w-[calc(100vw-32px)]"
            style={getCardStyle(spotlight, currentStep.cardPosition)}
          >
            <div className="card-glass rounded-2xl border border-primary/20 p-5 shadow-lg glow-primary">
              {/* Close/Skip */}
              <button
                onClick={handleSkip}
                className="absolute top-3 right-3 text-muted hover:text-heading transition-colors"
                title="Skip tour"
              >
                <X size={14} />
              </button>

              <h3 className="text-base font-bold text-gradient-accent mb-2">
                {currentStep.title}
              </h3>
              <p className="text-sm text-soft leading-relaxed mb-5">
                {currentStep.description}
              </p>

              {/* Navigation */}
              <div className="flex items-center justify-between">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleBack}
                  disabled={currentIndex === 0}
                  className={cn(currentIndex === 0 && "invisible")}
                >
                  <ChevronLeft size={14} />
                  Back
                </Button>

                {/* Progress dots */}
                <div className="flex items-center gap-1">
                  {TOUR_STEPS.map((_, i) => (
                    <div
                      key={i}
                      className={cn(
                        "h-1.5 rounded-full transition-all duration-300",
                        i === currentIndex
                          ? "w-4 bg-primary"
                          : i < currentIndex
                            ? "w-1.5 bg-primary/40"
                            : "w-1.5 bg-faint",
                      )}
                    />
                  ))}
                </div>

                <Button size="sm" onClick={handleNext} className="gap-1">
                  {isLast ? "Finish" : "Next"}
                  <ChevronRight size={14} />
                </Button>
              </div>

              {/* Step counter */}
              <div className="mt-3 text-center">
                <span className="text-[10px] text-muted">
                  {currentIndex + 1} of {TOUR_STEPS.length}
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>,
    document.body,
  );
}

/** SVG-based spotlight overlay with a transparent hole */
function SpotlightOverlay({ spotlight }: { spotlight: SpotlightRect | null }) {
  if (!spotlight) {
    return (
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-all duration-300" />
    );
  }

  const { top, left, width, height } = spotlight;
  const r = 8; // border-radius for the spotlight hole

  return (
    <svg
      className="absolute inset-0 h-full w-full transition-all duration-300"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <mask id="tour-spotlight-mask">
          <rect width="100%" height="100%" fill="white" />
          <rect
            x={left}
            y={top}
            width={width}
            height={height}
            rx={r}
            ry={r}
            fill="black"
          />
        </mask>
      </defs>
      <rect
        width="100%"
        height="100%"
        fill="rgba(0,0,0,0.6)"
        mask="url(#tour-spotlight-mask)"
        style={{ backdropFilter: "blur(2px)" }}
      />
      {/* Spotlight border glow */}
      <rect
        x={left}
        y={top}
        width={width}
        height={height}
        rx={r}
        ry={r}
        fill="none"
        stroke="var(--color-primary)"
        strokeWidth="1.5"
        strokeOpacity="0.4"
        className="animate-pulse-glow"
      />
    </svg>
  );
}
