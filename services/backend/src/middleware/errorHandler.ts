import type { FastifyError, FastifyRequest, FastifyReply } from "fastify";

export function errorHandler(error: FastifyError, _request: FastifyRequest, reply: FastifyReply) {
  const statusCode = error.statusCode ?? 500;
  reply.status(statusCode).send({
    error: error.message,
    code: error.code ?? "INTERNAL_ERROR",
    statusCode,
  });
}
