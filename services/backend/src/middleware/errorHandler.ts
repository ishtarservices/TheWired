import type { FastifyError, FastifyRequest, FastifyReply } from "fastify";
import { config } from "../config.js";

export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  const statusCode = error.statusCode ?? 500;

  if (statusCode >= 500) {
    request.log.error(error);
  }

  const message =
    config.isProduction && statusCode >= 500
      ? "Internal server error"
      : error.message;

  reply.status(statusCode).send({
    error: message,
    code: error.code ?? "INTERNAL_ERROR",
    statusCode,
  });
}
