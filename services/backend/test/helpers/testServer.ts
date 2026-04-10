/**
 * Builds a Fastify server instance for route testing.
 * Uses server.inject() for zero-network HTTP testing.
 */
import { createServer } from "../../src/server.js";
import type { FastifyInstance } from "fastify";

let cachedServer: FastifyInstance | null = null;

export async function buildTestServer(): Promise<FastifyInstance> {
  if (cachedServer) return cachedServer;
  cachedServer = await createServer();
  await cachedServer.ready();
  return cachedServer;
}

export async function closeTestServer(): Promise<void> {
  if (cachedServer) {
    await cachedServer.close();
    cachedServer = null;
  }
}
