import type { FastifyPluginAsync } from "fastify";
import { config } from "../config.js";

/**
 * Universal-links (iOS) and App Links (Android) association files for the soot
 * mobile app, served from the thewired.app web root (the prod Caddy proxy
 * forwards both /.well-known/ paths here, alongside nostr.json).
 *
 * Paths must cover every deep-linkable route the app claims: music share links
 * (track/album/playlist), artist catalogs, spaces, DMs, notes, articles,
 * invites, and bare nostr entities. Apple requires Content-Type
 * application/json with NO redirect on the AASA URL.
 */

/** Path patterns the mobile app handles. AASA `components` syntax; the same
 *  prefixes are mirrored into assetlinks-consuming intent filters app-side. */
const APP_LINK_PATTERNS = [
  "/music/*",
  "/profile/*",
  "/space/*",
  "/dm/*",
  "/note/*",
  "/article/*",
  "/invite/*",
  // Bare nostr entities at the web root (npub1…, nprofile1…, nevent1…, naddr1…, note1…)
  "/npub1*",
  "/nprofile1*",
  "/nevent1*",
  "/naddr1*",
  "/note1*",
];

export const wellKnownRoutes: FastifyPluginAsync = async (server) => {
  server.get("/.well-known/apple-app-site-association", async (_request, reply) => {
    return reply
      .header("Content-Type", "application/json")
      .header("Cache-Control", "public, max-age=3600")
      .send({
        applinks: {
          details: [
            {
              appIDs: config.appleAppIds,
              components: APP_LINK_PATTERNS.map((pattern) => ({ "/": pattern })),
            },
          ],
        },
      });
  });

  server.get("/.well-known/assetlinks.json", async (_request, reply) => {
    const statements =
      config.androidCertSha256.length > 0
        ? [
            {
              relation: ["delegate_permission/common.handle_all_urls"],
              target: {
                namespace: "android_app",
                package_name: config.androidPackageName,
                sha256_cert_fingerprints: config.androidCertSha256,
              },
            },
          ]
        : [];

    return reply
      .header("Content-Type", "application/json")
      .header("Cache-Control", "public, max-age=3600")
      .send(statements);
  });
};
