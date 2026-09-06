import type { FastifyPluginAsync } from "fastify";
import { config } from "../config.js";
import { profileCacheService } from "../services/profileCacheService.js";
import { fetchLatestByAddressableId } from "../services/musicVisibility.js";

/**
 * Server-rendered share pages with OpenGraph metadata for web share links
 * (thewired.app/music/… and /profile/…). The prod Caddy proxy forwards those
 * paths here; the mobile app claims the same paths as universal links, so this
 * page is only seen by browsers and link-preview crawlers.
 *
 * Privacy: metadata is rendered for PUBLIC events only. Private (`visibility`)
 * and space-scoped (`h`) events get the same generic branded page as a
 * nonexistent slug — no title/artwork leak, and no existence oracle.
 */

const KIND_BY_TYPE: Record<string, number> = { track: 31683, album: 33123, playlist: 30119 };
const OG_TYPE_BY_TYPE: Record<string, string> = {
  track: "music.song",
  album: "music.album",
  playlist: "music.playlist",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Only http(s) URLs may be echoed into og:image / <img>. */
function safeImageUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

interface PreviewMeta {
  title: string;
  description: string;
  imageUrl: string | null;
  ogType: string;
  canonicalPath: string;
}

function renderPreviewPage(meta: PreviewMeta): string {
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);
  const canonicalUrl = escapeHtml(`${config.webBaseUrl}${meta.canonicalPath}`);
  const image = meta.imageUrl ? escapeHtml(meta.imageUrl) : null;
  const deepLink = escapeHtml(`soot:/${meta.canonicalPath}`);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta property="og:site_name" content="The Wired">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:type" content="${escapeHtml(meta.ogType)}">
<meta property="og:url" content="${canonicalUrl}">
${image ? `<meta property="og:image" content="${image}">` : ""}
<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}">
${image ? `<meta name="twitter:image" content="${image}">` : ""}
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         background: #0a0a0f; color: #e5e5ec; font-family: system-ui, -apple-system, sans-serif; }
  main { text-align: center; padding: 2rem; max-width: 26rem; }
  img { width: 14rem; height: 14rem; object-fit: cover; border-radius: 1rem; margin-bottom: 1.5rem; }
  h1 { font-size: 1.25rem; margin: 0 0 0.25rem; }
  p { color: #9ca3af; margin: 0 0 1.5rem; }
  a.open { display: inline-block; background: #7c3aed; color: #fff; text-decoration: none;
           padding: 0.6rem 1.6rem; border-radius: 9999px; font-weight: 600; }
</style>
</head>
<body>
<main>
${image ? `<img src="${image}" alt="">` : ""}
<h1>${title}</h1>
<p>${description}</p>
<a class="open" href="${deepLink}">Open in the app</a>
</main>
</body>
</html>
`;
}

function sendPreview(reply: import("fastify").FastifyReply, meta: PreviewMeta) {
  return reply
    .header("Content-Type", "text/html; charset=utf-8")
    .header("Cache-Control", "public, max-age=300")
    .send(renderPreviewPage(meta));
}

function genericMeta(canonicalPath: string): PreviewMeta {
  return {
    title: "The Wired",
    description: "Music on The Wired",
    imageUrl: null,
    ogType: "website",
    canonicalPath,
  };
}

function tagValue(tags: string[][], name: string): string | undefined {
  return tags.find((t) => t[0] === name)?.[1];
}

export const linkPreviewRoutes: FastifyPluginAsync = async (server) => {
  // GET /music/:type/:pubkey/:slug — share page for a track/album/playlist
  server.get<{ Params: { type: string; pubkey: string; slug: string } }>(
    "/music/:type/:pubkey/:slug",
    async (request, reply) => {
      const { type, pubkey, slug } = request.params;
      const kind = KIND_BY_TYPE[type];
      const canonicalPath = `/music/${type}/${pubkey}/${encodeURIComponent(slug)}`;
      if (!kind || !/^[0-9a-f]{64}$/.test(pubkey)) {
        return sendPreview(reply, genericMeta(canonicalPath));
      }

      const event = await fetchLatestByAddressableId(`${kind}:${pubkey}:${slug}`);
      const isPublic =
        event != null &&
        !tagValue(event.tags, "visibility") &&
        !tagValue(event.tags, "h");

      if (!isPublic) {
        return sendPreview(reply, genericMeta(canonicalPath));
      }

      const title = tagValue(event.tags, "title") ?? "Untitled";
      const artist = tagValue(event.tags, "artist");
      return sendPreview(reply, {
        title: artist ? `${title} — ${artist}` : title,
        description: "Listen on The Wired",
        imageUrl: safeImageUrl(tagValue(event.tags, "image") ?? tagValue(event.tags, "thumb")),
        ogType: OG_TYPE_BY_TYPE[type],
        canonicalPath,
      });
    },
  );

  // GET /profile/:pubkey — share page for an artist/user profile
  server.get<{ Params: { pubkey: string }; Querystring: { section?: string } }>(
    "/profile/:pubkey",
    async (request, reply) => {
      const { pubkey } = request.params;
      const section = (request.query as { section?: string }).section;
      const canonicalPath = `/profile/${pubkey}${section === "music" ? "?section=music" : ""}`;
      if (!/^[0-9a-f]{64}$/.test(pubkey)) {
        return sendPreview(reply, genericMeta(canonicalPath));
      }

      const profile = await profileCacheService.getProfile(pubkey);
      const name =
        profile?.displayName || profile?.name || `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`;

      return sendPreview(reply, {
        title: name,
        description:
          section === "music" ? `Music by ${name} on The Wired` : `${name} on The Wired`,
        imageUrl: safeImageUrl(profile?.picture),
        ogType: "profile",
        canonicalPath,
      });
    },
  );
};
