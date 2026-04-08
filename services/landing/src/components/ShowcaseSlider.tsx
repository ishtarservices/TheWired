import { useRef, useEffect } from 'react';

type Slide = {
  title: string;
  description: string;
} & ({ type: 'image'; screenshot: string } | { type: 'video'; video: string });

const slides: Slide[] = [
  {
    type: 'image',
    title: 'Community Spaces',
    description: 'Create spaces with channels and members for your community to connect and collaborate.',
    screenshot: '/screenshots/spaces.png',
  },
  {
    type: 'image',
    title: 'Music Library',
    description: 'Upload tracks, create projects, and build playlists — all inside the platform.',
    screenshot: '/screenshots/music.png',
  },
  {
    type: 'video',
    title: 'Customize Themes',
    description: 'Switch between themes and watch the entire interface transform to match your style.',
    video: '/screenshots/ChangingThemes.mov',
  },
  {
    type: 'image',
    title: 'Your Profile',
    description: 'A customizable profile that travels with you across the entire Nostr ecosystem.',
    screenshot: '/screenshots/profile.png',
  },
  {
    type: 'video',
    title: 'Customize Your Profile',
    description: 'Control exactly what others see — hide follower and following counts, choose which profile tabs are visible, and edit your display name, bio, avatar, and banner.',
    video: '/screenshots/CustomizeWhatOthers See onYourProfile.mov',
  },
  {
    type: 'image',
    title: 'Create & Collaborate',
    description: 'Start music projects, invite collaborators, and manage your creative work.',
    screenshot: '/screenshots/create-project.png',
  },
];

function SlideMedia({ slide }: { slide: Slide }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.play().catch(() => {});
        } else {
          el.pause();
        }
      },
      { threshold: 0.5 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (slide.type === 'video') {
    return (
      <video
        ref={videoRef}
        src={slide.video}
        className="w-full h-full object-contain rounded-lg"
        style={{ background: '#0C0910' }}
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
      className="w-full h-full object-contain rounded-lg"
      style={{ background: '#0C0910' }}
      loading="lazy"
    />
  );
}

export default function ShowcaseSlider() {
  return (
    <div
      id="showcase-track"
      className="flex gap-5 overflow-x-auto px-6 pb-4 snap-x snap-mandatory scroll-smooth"
      style={{
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      {/* Left spacer */}
      <div className="flex-shrink-0 w-[max(0px,calc((100vw-80rem)/2))]" />

      {slides.map((slide, i) => (
        <div
          key={i}
          className="showcase-card flex-shrink-0 snap-start"
          style={{ width: 'min(520px, 80vw)' }}
        >
          {/* Media container */}
          <div
            className="w-full rounded-lg overflow-hidden"
            style={{ aspectRatio: '16 / 10', background: '#1E1824', border: '0.5px solid #221A2C' }}
          >
            <SlideMedia slide={slide} />
          </div>

          {/* Caption */}
          <div className="mt-4 space-y-1.5">
            <div className="flex items-center gap-2.5">
              <div
                className="w-1 h-5 rounded-full"
                style={{ background: '#607060' }}
              />
              <h3 className="font-semibold text-lg" style={{ color: '#E4DDE8' }}>
                {slide.title}
              </h3>
              {slide.type === 'video' && (
                <span
                  className="px-2 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider"
                  style={{ background: '#1E1824', border: '0.5px solid #384038', color: '#889880' }}
                >
                  Video
                </span>
              )}
            </div>
            <p className="text-sm leading-relaxed" style={{ color: '#9A8FA8' }}>
              {slide.description}
            </p>
          </div>
        </div>
      ))}

      {/* Right spacer */}
      <div className="flex-shrink-0 w-6" />
    </div>
  );
}
