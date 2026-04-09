import { useState, useEffect, type JSX } from 'react';
import { detectPlatform, fetchLatestRelease, RELEASES_URL, type Platform, type ReleaseInfo } from '../lib/platforms';

const osIcons: Record<string, (size: number) => JSX.Element> = {
  macos: (size) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
    </svg>
  ),
  windows: (size) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801"/>
    </svg>
  ),
  linux: (size) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.503 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.836-.41 1.722-.41 2.621 0 .246.012.498.037.753.07.715.303 1.222.612 1.611.299.377.67.651 1.077.862.814.422 1.785.623 2.727.623.616 0 1.22-.09 1.768-.277.136.36.318.699.548 1.004.63.831 1.593 1.336 2.694 1.336 1.11 0 2.075-.52 2.711-1.359.224-.297.4-.624.534-.976.55.191 1.157.284 1.774.284.941 0 1.913-.201 2.727-.623.407-.211.778-.485 1.077-.862.31-.389.543-.896.613-1.611.024-.255.036-.507.036-.753 0-.899-.132-1.785-.41-2.621-.59-1.771-1.831-3.47-2.717-4.521-.749-1.067-.973-1.928-1.048-3.02-.066-1.491 1.056-5.965-3.17-6.298A5.597 5.597 0 0 0 12.503 0z"/>
    </svg>
  ),
};

type CardDef = {
  os: string;
  label: string;
  sublabel: string;
  iconKey: string;
};

const downloadCards: CardDef[] = [
  { os: 'macos', label: 'macOS', sublabel: 'Apple Silicon', iconKey: 'macos' },
  { os: 'macos-intel', label: 'macOS', sublabel: 'Intel', iconKey: 'macos' },
  { os: 'windows', label: 'Windows', sublabel: 'x64', iconKey: 'windows' },
  { os: 'linux', label: 'Linux', sublabel: 'AppImage', iconKey: 'linux' },
  { os: 'linux-deb', label: 'Linux', sublabel: '.deb', iconKey: 'linux' },
];

export default function DownloadButton() {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [release, setRelease] = useState<ReleaseInfo | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const detected = detectPlatform();
    setPlatform(detected);

    fetchLatestRelease(detected.os)
      .then(setRelease)
      .catch(() => setError(true));
  }, []);

  if (error) {
    return (
      <div className="flex justify-center">
        <a
          href={RELEASES_URL}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-semibold transition-all hover-glow-cyan"
          style={{ border: '0.5px solid #221A2C', background: '#130F18', color: '#E4DDE8' }}
        >
          Download from GitHub Releases
        </a>
      </div>
    );
  }

  if (!platform || !release) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {downloadCards.map((_, i) => (
          <div
            key={i}
            className="h-36 rounded-lg animate-pulse"
            style={{ background: '#1E1824' }}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {downloadCards.map((card) => {
        const link = release.links.find((l) => l.os === card.os);
        if (!link) return null;

        const isPrimary = link.primary;
        const renderIcon = osIcons[card.iconKey] || osIcons.linux;

        return (
          <a
            key={card.os}
            href={link.url}
            className={`
              group relative flex flex-col items-center gap-2.5 p-5 rounded-lg
              transition-all press-effect text-center
              ${isPrimary ? '' : 'hover-glow-cyan'}
            `}
            style={isPrimary ? {
              background: '#607060',
              color: '#E4DDE8',
            } : {
              border: '0.5px solid #221A2C',
              background: '#130F18',
              color: '#9A8FA8',
            }}
          >
            {isPrimary && (
              <span
                className="absolute -top-2.5 left-1/2 -translate-x-1/2 z-10 px-2.5 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider font-semibold"
                style={{ background: '#889880', color: '#0C0910' }}
              >
                Detected
              </span>
            )}
            <div className="relative z-10 w-10 h-10 flex items-center justify-center">
              {renderIcon(36)}
            </div>
            <div className="relative z-10 font-semibold text-sm">{card.label}</div>
            <div className="relative z-10 text-[11px] font-mono opacity-70">{card.sublabel}</div>
            <div className="relative z-10 text-[10px] font-mono opacity-50">v{release.version}</div>
            {isPrimary && (
              <div
                className="absolute inset-0 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ background: '#889880' }}
              />
            )}
          </a>
        );
      })}
    </div>
  );
}
