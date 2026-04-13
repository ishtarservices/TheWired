import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import { config } from "./config.js";
import { blossomRoutes } from "./routes/blossom.js";
import { healthRoutes } from "./routes/health.js";
import { spacesRoutes } from "./routes/spaces.js";
import { invitesRoutes } from "./routes/invites.js";
import { membersRoutes } from "./routes/members.js";
import { permissionsRoutes } from "./routes/permissions.js";
import { searchRoutes } from "./routes/search.js";
import { feedsRoutes } from "./routes/feeds.js";
import { pushRoutes } from "./routes/push.js";
import { analyticsRoutes } from "./routes/analytics.js";
import { contentRoutes } from "./routes/content.js";
import { profilesRoutes } from "./routes/profiles.js";
import { musicRoutes } from "./routes/music.js";
import { insightsRoutes } from "./routes/insights.js";
import { revisionRoutes } from "./routes/revisions.js";
import { proposalRoutes } from "./routes/proposals.js";
import { channelsRoutes } from "./routes/channels.js";
import { rolesRoutes } from "./routes/roles.js";
import { moderationRoutes } from "./routes/moderation.js";
import { notificationsRoutes } from "./routes/notifications.js";
import { voiceRoutes } from "./routes/voice.js";
import { gifRoutes } from "./routes/gif.js";
import { discoveryRoutes } from "./routes/discovery.js";
import { onboardingRoutes } from "./routes/onboarding.js";
import { nip05Routes, nip05ApiRoutes } from "./routes/nip05.js";
import { authContext } from "./middleware/authContext.js";
import { errorHandler } from "./middleware/errorHandler.js";

export async function createServer() {
  const server = Fastify({
    logger: {
      level: config.logLevel,
    },
  });

  await server.register(cors, {
    origin: config.allowedOrigins.length > 0 ? config.allowedOrigins : true,
  });
  await server.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  });
  await server.register(multipart, { limits: { fileSize: config.maxBlobSize } });

  // Global hooks
  server.addHook("onRequest", authContext);
  server.setErrorHandler(errorHandler);

  // Register routes
  await server.register(healthRoutes);
  await server.register(spacesRoutes, { prefix: "/spaces" });
  await server.register(invitesRoutes, { prefix: "/invites" });
  await server.register(membersRoutes, { prefix: "/spaces" });
  await server.register(permissionsRoutes, { prefix: "/permissions" });
  await server.register(searchRoutes, { prefix: "/search" });
  await server.register(feedsRoutes, { prefix: "/feeds" });
  await server.register(pushRoutes, { prefix: "/push" });
  await server.register(analyticsRoutes, { prefix: "/analytics" });
  await server.register(contentRoutes, { prefix: "/content" });
  await server.register(profilesRoutes, { prefix: "/profiles" });
  await server.register(musicRoutes, { prefix: "/music" });
  await server.register(insightsRoutes, { prefix: "/music" });
  await server.register(revisionRoutes, { prefix: "/music" });
  await server.register(proposalRoutes, { prefix: "/music" });
  await server.register(channelsRoutes, { prefix: "/spaces" });
  await server.register(rolesRoutes, { prefix: "/spaces" });
  await server.register(moderationRoutes, { prefix: "/spaces" });
  await server.register(notificationsRoutes, { prefix: "/notifications" });
  await server.register(voiceRoutes, { prefix: "/voice" });
  await server.register(gifRoutes, { prefix: "/gif" });
  await server.register(discoveryRoutes, { prefix: "/discovery" });
  await server.register(onboardingRoutes, { prefix: "/spaces" });
  await server.register(nip05Routes);
  await server.register(nip05ApiRoutes, { prefix: "/nip05" });

  // Blossom routes (root-level: GET /<sha256>, PUT /upload, DELETE /<sha256>, GET /list/<pubkey>)
  // Registered last so /:filename catch-all doesn't shadow named routes
  await server.register(blossomRoutes);

  return server;
}
