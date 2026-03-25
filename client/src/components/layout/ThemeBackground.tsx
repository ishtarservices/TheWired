import { useTheme } from "../../contexts/ThemeContext";

export function ThemeBackground() {
  const { config } = useTheme();
  const bg = config.background;

  if (!bg) return null;

  const isVideo = bg.mimeType?.startsWith("video/");

  return (
    <div className="fixed inset-0" style={{ zIndex: -1 }}>
      {isVideo ? (
        <video
          src={bg.url}
          autoPlay
          muted
          loop
          playsInline
          className="h-full w-full object-cover"
        />
      ) : (
        <img
          src={bg.url}
          alt=""
          className={`h-full w-full ${bg.mode === "tile" ? "object-none" : "object-cover"}`}
        />
      )}
      {/* Readability overlay */}
      <div
        className="absolute inset-0 bg-background/85"
      />
    </div>
  );
}
