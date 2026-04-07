import { useState, useEffect, type JSX } from 'react';
import { detectPlatform, getDownloadLinks, type Platform } from '../lib/platforms';

const osIcons: Record<string, JSX.Element> = {
  macos: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
    </svg>
  ),
  windows: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801"/>
    </svg>
  ),
  linux: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.503 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.836-.41 1.722-.41 2.621 0 .246.012.498.037.753.07.715.303 1.222.612 1.611.299.377.67.651 1.077.862.814.422 1.785.623 2.727.623.616 0 1.22-.09 1.768-.277.136.36.318.699.548 1.004.63.831 1.593 1.336 2.694 1.336 1.11 0 2.075-.52 2.711-1.359.224-.297.4-.624.534-.976.55.191 1.157.284 1.774.284.941 0 1.913-.201 2.727-.623.407-.211.778-.485 1.077-.862.31-.389.543-.896.613-1.611.024-.255.036-.507.036-.753 0-.899-.132-1.785-.41-2.621-.59-1.771-1.831-3.47-2.717-4.521-.749-1.067-.973-1.928-1.048-3.02-.066-1.491 1.056-5.965-3.17-6.298A5.597 5.597 0 0 0 12.503 0z"/>
    </svg>
  ),
};

export default function DownloadButton() {
  const [platform, setPlatform] = useState<Platform | null>(null);

  useEffect(() => {
    setPlatform(detectPlatform());
  }, []);

  if (!platform) {
    return (
      <div className="space-y-6">
        <div className="h-14 w-64 mx-auto rounded-xl animate-pulse" style={{ background: 'hsl(230 18% 10%)' }} />
        <div className="flex justify-center gap-3">
          <div className="h-12 w-36 rounded-lg animate-pulse" style={{ background: 'hsl(230 18% 10%)' }} />
          <div className="h-12 w-36 rounded-lg animate-pulse" style={{ background: 'hsl(230 18% 10%)' }} />
          <div className="h-12 w-36 rounded-lg animate-pulse" style={{ background: 'hsl(230 18% 10%)' }} />
        </div>
      </div>
    );
  }

  const links = getDownloadLinks(platform.os);
  const primaryLink = links.find((l) => l.primary);
  const secondaryLinks = links.filter((l) => !l.primary);

  return (
    <div className="space-y-6">
      {/* Primary download button — cyber gradient */}
      {primaryLink && (
        <a
          href={primaryLink.url}
          className="group relative inline-flex items-center gap-3 px-10 py-4 rounded-xl font-semibold text-lg transition-all press-effect overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, hsl(185 100% 55%), hsl(265 100% 70%))',
            color: 'hsl(230 20% 5%)',
          }}
        >
          <span className="relative z-10 flex items-center gap-3">
            {osIcons[platform.os] || osIcons.linux}
            Download for {platform.label}
          </span>
          {/* Hover gradient shift */}
          <div
            className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ background: 'linear-gradient(135deg, hsl(185 80% 65%), hsl(310 100% 65%))' }}
          />
          {/* Shimmer */}
          <div
            className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700"
            style={{ background: 'linear-gradient(90deg, transparent, hsl(0 0% 100% / 0.15), transparent)' }}
          />
        </a>
      )}

      {/* Secondary platform links — cyber styled */}
      <div className="flex flex-wrap justify-center gap-3">
        {secondaryLinks.map((link) => (
          <a
            key={link.fileName}
            href={link.url}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg transition-all text-sm font-medium hover-glow-cyan"
            style={{
              border: '1px solid hsl(185 100% 55% / 0.1)',
              color: 'hsl(220 15% 65%)',
              background: 'hsl(230 20% 7% / 0.5)',
            }}
          >
            {osIcons[link.os.split('-')[0]] || osIcons.linux}
            {link.label}
          </a>
        ))}
      </div>
    </div>
  );
}
