import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';

type Slide = {
  title: string;
  description: string;
  accent: string;
} & ({ type: 'image'; screenshot: string } | { type: 'video'; video: string });

const slides: Slide[] = [
  {
    type: 'image',
    title: 'Community Spaces',
    description: 'Create spaces with channels and members for your community to connect and collaborate.',
    screenshot: '/screenshots/spaces.png',
    accent: 'hsl(185 100% 55%)',
  },
  {
    type: 'image',
    title: 'Your Profile',
    description: 'A customizable profile that travels with you across the entire Nostr ecosystem.',
    screenshot: '/screenshots/profile.png',
    accent: 'hsl(265 100% 70%)',
  },
  {
    type: 'video',
    title: 'Customize Your Profile',
    description: 'Control exactly what others see — edit your display name, bio, avatar, and banner in real time.',
    video: '/screenshots/CustomizeWhatOthers See onYourProfile.mov',
    accent: 'hsl(310 100% 65%)',
  },
  {
    type: 'image',
    title: 'Music Library',
    description: 'Upload tracks, create projects, and build playlists — all inside the platform.',
    screenshot: '/screenshots/music.png',
    accent: 'hsl(310 100% 65%)',
  },
  {
    type: 'video',
    title: 'Live Theme Switching',
    description: 'Switch between themes instantly — the entire interface adapts in real time.',
    video: '/screenshots/ChangingThemes.mov',
    accent: 'hsl(185 100% 55%)',
  },
  {
    type: 'image',
    title: 'Create & Collaborate',
    description: 'Start music projects, invite collaborators, and manage your creative work.',
    screenshot: '/screenshots/create-project.png',
    accent: 'hsl(185 100% 55%)',
  },
];

function SlideMedia({ slide }: { slide: Slide }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (slide.type === 'video' && videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.play().catch(() => {});
    }
  }, [slide]);

  if (slide.type === 'video') {
    return (
      <video
        ref={videoRef}
        src={slide.video}
        className="w-full h-full object-cover"
        autoPlay
        muted
        loop
        playsInline
      />
    );
  }

  return (
    <img
      src={slide.screenshot}
      alt={slide.title}
      className="w-full h-full object-cover"
    />
  );
}

export default function ShowcaseSlider() {
  const [current, setCurrent] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  const next = useCallback(() => {
    setCurrent((prev) => (prev + 1) % slides.length);
  }, []);

  const prev = useCallback(() => {
    setCurrent((prev) => (prev - 1 + slides.length) % slides.length);
  }, []);

  useEffect(() => {
    if (isPaused) return;
    const delay = slides[current].type === 'video' ? 8000 : 5000;
    const timer = setInterval(next, delay);
    return () => clearInterval(timer);
  }, [isPaused, next, current]);

  const slide = slides[current];

  return (
    <div
      className="relative"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      {/* Slide area — fixed aspect ratio for consistent sizing */}
      <div
        className="relative overflow-hidden rounded-xl"
        style={{ background: 'hsl(230 20% 5%)', aspectRatio: '16 / 9' }}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={current}
            className="absolute inset-0"
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 }}
            transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
          >
            <SlideMedia slide={slide} />

            {/* Caption overlay */}
            <div
              className="absolute bottom-0 left-0 right-0 p-6"
              style={{ background: 'linear-gradient(to top, hsl(230 20% 5% / 0.95) 0%, hsl(230 20% 5% / 0.6) 60%, transparent 100%)' }}
            >
              <div className="flex items-center gap-3 mb-2">
                <div
                  className="w-1 h-6 rounded-full"
                  style={{ background: slide.accent, boxShadow: `0 0 8px ${slide.accent}` }}
                />
                <h3 className="font-semibold text-xl" style={{ color: 'hsl(210 40% 96%)' }}>{slide.title}</h3>
                {slide.type === 'video' && (
                  <span
                    className="px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider"
                    style={{ background: 'hsl(185 100% 55% / 0.1)', border: '1px solid hsl(185 100% 55% / 0.2)', color: 'hsl(185 100% 55% / 0.7)' }}
                  >
                    Video
                  </span>
                )}
              </div>
              <p className="text-sm ml-4" style={{ color: 'hsl(220 15% 65%)' }}>{slide.description}</p>
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Navigation arrows */}
        <button
          onClick={prev}
          className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full glass-panel flex items-center justify-center transition-colors z-10 hover-glow-cyan"
          style={{ color: 'hsl(220 15% 65%)' }}
          aria-label="Previous slide"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="15,18 9,12 15,6" />
          </svg>
        </button>
        <button
          onClick={next}
          className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full glass-panel flex items-center justify-center transition-colors z-10 hover-glow-cyan"
          style={{ color: 'hsl(220 15% 65%)' }}
          aria-label="Next slide"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="9,6 15,12 9,18" />
          </svg>
        </button>
      </div>

      {/* Dot indicators — cyber style */}
      <div className="flex justify-center gap-2 mt-5">
        {slides.map((s, i) => (
          <button
            key={i}
            onClick={() => setCurrent(i)}
            className="h-1.5 rounded-full transition-all duration-300"
            style={{
              width: i === current ? '2rem' : '0.5rem',
              background: i === current ? s.accent : 'hsl(220 10% 35%)',
              boxShadow: i === current ? `0 0 8px ${s.accent}` : 'none',
            }}
            aria-label={`Go to slide ${i + 1}`}
          />
        ))}
      </div>
    </div>
  );
}
