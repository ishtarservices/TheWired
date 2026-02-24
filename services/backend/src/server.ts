import { join } from "path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { config } from "./config.js";
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
import { authContext } from "./middleware/authContext.js";
import { errorHandler } from "./middleware/errorHandler.js";

export async function createServer() {
  const server = Fastify({
    logger: {
      level: config.logLevel,
    },
  });

  await server.register(cors, { origin: true });
  await server.register(multipart, { limits: { fileSize: 100 * 1024 * 1024 } });

  // Static file serving for uploads (cover art, audio files)
  await server.register(fastifyStatic, {
    root: join(process.cwd(), "uploads"),
    prefix: "/uploads/",
    decorateReply: false,
  });

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

  return server;
}
