import { useState, useEffect, useRef } from "react";
import { ExternalLink } from "lucide-react";
import type { EmbedMatch, EmbedPlatform } from "@/lib/content/embedPatterns";

const PLATFORM_LABELS: Record<EmbedPlatform, string> = {
  youtube: "YouTube",
  twitter: "X (Twitter)",
  spotify: "Spotify",
  tiktok: "TikTok",
  instagram: "Instagram",
  tenor: "Tenor GIF",
};

const PLATFORM_COLORS: Record<EmbedPlatform, string> = {
  youtube: "bg-red-500",
  twitter: "bg-sky-400",
  spotify: "bg-green-500",
  tiktok: "bg-pink-500",
  instagram: "bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-500",
  tenor: "bg-blue-400",
};

interface EmbedRendererProps {
  embed: EmbedMatch;
}

export function EmbedRenderer({ embed }: EmbedRendererProps) {
  if (embed.embedUrl) {
    return <EmbedIframe embed={embed} />;
  }
  return <EmbedLinkCard embed={embed} />;
}

function EmbedIframe({ embed }: { embed: EmbedMatch }) {
  const [error, setError] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const tag = `[EmbedRenderer:${embed.platform}]`;
    console.log(`${tag} Mounting iframe`, {
      embedUrl: embed.embedUrl,
      originalUrl: embed.originalUrl,
      windowOrigin: window.location.origin,
      windowHref: window.location.href,
    });

    // Listen for YouTube postMessage errors (Error 153 is reported this way)
    const handleMessage = (e: MessageEvent) => {
      // YouTube sends messages from its embed origin
      if (
        typeof e.data === "string" &&
        e.data.includes("youtube")
      ) {
        console.log(`${tag} postMessage (string) from ${e.origin}:`, e.data);
      }
      if (typeof e.data === "object" && e.data !== null) {
        // YouTube IFrame API sends JSON with event/info keys
        const info = (e.data as Record<string, unknown>).info ??
          (e.data as Record<string, unknown>).event ??
          e.data;
        console.log(`${tag} postMessage (object) from ${e.origin}:`, JSON.stringify(info, null, 2));
      }
    };

    // Listen for CSP violations — these block iframe loads silently
    const handleCSPViolation = (e: SecurityPolicyViolationEvent) => {
      console.error(`${tag} CSP VIOLATION:`, {
        blockedURI: e.blockedURI,
        violatedDirective: e.violatedDirective,
        effectiveDirective: e.effectiveDirective,
        originalPolicy: e.originalPolicy,
        sourceFile: e.sourceFile,
        lineNumber: e.lineNumber,
      });
    };

    window.addEventListener("message", handleMessage);
    document.addEventListener("securitypolicyviolation", handleCSPViolation);

    return () => {
      window.removeEventListener("message", handleMessage);
      document.removeEventListener("securitypolicyviolation", handleCSPViolation);
    };
  }, [embed.embedUrl, embed.originalUrl, embed.platform]);

  if (error) {
    return <EmbedLinkCard embed={embed} />;
  }

  const dimensions = getIframeDimensions(embed.platform);

  return (
    <div className="my-2 -mx-3 min-w-[280px] max-w-md overflow-hidden rounded-lg border border-border-light">
      <div className={dimensions.wrapperClass}>
        <iframe
          ref={iframeRef}
          src={embed.embedUrl!}
          title={`${PLATFORM_LABELS[embed.platform]} embed`}
          className={dimensions.iframeClass}
          {...(embed.platform === "youtube"
            ? {} // YouTube's player breaks under sandbox restrictions (Error 153)
            : { sandbox: "allow-scripts allow-same-origin allow-popups allow-forms" }
          )}
          referrerPolicy="strict-origin-when-cross-origin"
          loading="lazy"
          allowFullScreen
          allow="autoplay; encrypted-media; fullscreen"
          onLoad={() => {
            console.log(`[EmbedRenderer:${embed.platform}] iframe onLoad fired`, {
              src: iframeRef.current?.src,
            });
          }}
          onError={(e) => {
            console.error(`[EmbedRenderer:${embed.platform}] iframe onError fired`, e);
            setError(true);
          }}
        />
      </div>
      <EmbedFooter embed={embed} />
    </div>
  );
}

function EmbedLinkCard({ embed }: { embed: EmbedMatch }) {
  return (
    <div className="my-2 -mx-3 min-w-[280px] max-w-md overflow-hidden rounded-lg border border-border-light bg-surface">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className={`h-2.5 w-2.5 shrink-0 rounded-full ${PLATFORM_COLORS[embed.platform]}`} />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-heading">
            {PLATFORM_LABELS[embed.platform]}
          </div>
          <div className="truncate text-[11px] text-muted">
            {embed.originalUrl}
          </div>
        </div>
        <a
          href={embed.originalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-md bg-surface-hover p-1.5 text-soft hover:bg-surface-hover/80 hover:text-heading transition-colors"
        >
          <ExternalLink size={12} />
        </a>
      </div>
    </div>
  );
}

function EmbedFooter({ embed }: { embed: EmbedMatch }) {
  return (
    <div className="flex items-center justify-between border-t border-border px-3 py-1.5 bg-surface">
      <div className="flex items-center gap-2">
        <div className={`h-2 w-2 rounded-full ${PLATFORM_COLORS[embed.platform]}`} />
        <span className="text-[11px] text-muted">{PLATFORM_LABELS[embed.platform]}</span>
      </div>
      <a
        href={embed.originalUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1 text-[11px] text-soft hover:text-heading transition-colors"
      >
        Open
        <ExternalLink size={10} />
      </a>
    </div>
  );
}

function getIframeDimensions(platform: EmbedPlatform) {
  switch (platform) {
    case "youtube":
      return {
        wrapperClass: "relative w-full aspect-video",
        iframeClass: "absolute inset-0 h-full w-full",
      };
    case "spotify":
      return {
        wrapperClass: "w-full",
        iframeClass: "w-full h-[152px]",
      };
    case "tiktok":
      return {
        wrapperClass: "flex justify-center bg-black",
        iframeClass: "w-[325px] h-[580px]",
      };
    case "twitter":
      return {
        wrapperClass: "w-full",
        iframeClass: "w-full h-[400px]",
      };
    default:
      return {
        wrapperClass: "relative w-full aspect-video",
        iframeClass: "absolute inset-0 h-full w-full",
      };
  }
}
