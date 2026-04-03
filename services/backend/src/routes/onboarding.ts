import type { FastifyPluginAsync } from "fastify";
import { onboardingService } from "../services/onboardingService.js";
import { permissionService } from "../services/permissionService.js";

export const onboardingRoutes: FastifyPluginAsync = async (server) => {
  // ── Admin Endpoints (require MANAGE_SPACE) ──────────────────────

  /** GET /:spaceId/onboarding — Full admin view (config + questions + todos) */
  server.get<{ Params: { spaceId: string } }>(
    "/:spaceId/onboarding",
    async (request, reply) => {
      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });

      const { spaceId } = request.params;
      const perm = await permissionService.check(spaceId, pubkey, "MANAGE_SPACE");
      if (!perm.allowed) return reply.status(403).send({ error: "Forbidden", code: "FORBIDDEN" });

      const data = await onboardingService.getFullConfig(spaceId);
      return { data };
    },
  );

  /** PUT /:spaceId/onboarding/config — Upsert config */
  server.put<{
    Params: { spaceId: string };
    Body: { enabled?: boolean; welcomeMessage?: string | null; welcomeImage?: string | null; requireCompletion?: boolean };
  }>(
    "/:spaceId/onboarding/config",
    async (request, reply) => {
      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });

      const { spaceId } = request.params;
      const perm = await permissionService.check(spaceId, pubkey, "MANAGE_SPACE");
      if (!perm.allowed) return reply.status(403).send({ error: "Forbidden", code: "FORBIDDEN" });

      const config = await onboardingService.upsertConfig(spaceId, request.body);
      return { data: config };
    },
  );

  // ── Questions ───────────────────────────────────────────────────

  /** POST /:spaceId/onboarding/questions — Create question */
  server.post<{
    Params: { spaceId: string };
    Body: { title: string; description?: string; required?: boolean; multiple?: boolean };
  }>(
    "/:spaceId/onboarding/questions",
    async (request, reply) => {
      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });

      const { spaceId } = request.params;
      const perm = await permissionService.check(spaceId, pubkey, "MANAGE_SPACE");
      if (!perm.allowed) return reply.status(403).send({ error: "Forbidden", code: "FORBIDDEN" });

      const question = await onboardingService.createQuestion(spaceId, request.body);
      return { data: question };
    },
  );

  /** PATCH /:spaceId/onboarding/questions/:qId — Update question */
  server.patch<{
    Params: { spaceId: string; qId: string };
    Body: { title?: string; description?: string | null; required?: boolean; multiple?: boolean };
  }>(
    "/:spaceId/onboarding/questions/:qId",
    async (request, reply) => {
      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });

      const { spaceId, qId } = request.params;
      const perm = await permissionService.check(spaceId, pubkey, "MANAGE_SPACE");
      if (!perm.allowed) return reply.status(403).send({ error: "Forbidden", code: "FORBIDDEN" });

      const question = await onboardingService.updateQuestion(qId, request.body);
      return { data: question };
    },
  );

  /** DELETE /:spaceId/onboarding/questions/:qId — Delete question */
  server.delete<{ Params: { spaceId: string; qId: string } }>(
    "/:spaceId/onboarding/questions/:qId",
    async (request, reply) => {
      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });

      const { spaceId, qId } = request.params;
      const perm = await permissionService.check(spaceId, pubkey, "MANAGE_SPACE");
      if (!perm.allowed) return reply.status(403).send({ error: "Forbidden", code: "FORBIDDEN" });

      await onboardingService.deleteQuestion(qId);
      return { data: { success: true } };
    },
  );

  /** POST /:spaceId/onboarding/questions/reorder — Reorder questions */
  server.post<{
    Params: { spaceId: string };
    Body: { orderedIds: string[] };
  }>(
    "/:spaceId/onboarding/questions/reorder",
    async (request, reply) => {
      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });

      const { spaceId } = request.params;
      const perm = await permissionService.check(spaceId, pubkey, "MANAGE_SPACE");
      if (!perm.allowed) return reply.status(403).send({ error: "Forbidden", code: "FORBIDDEN" });

      await onboardingService.reorderQuestions(spaceId, request.body.orderedIds);
      return { data: { success: true } };
    },
  );

  // ── Answers ─────────────────────────────────────────────────────

  /** POST /:spaceId/onboarding/questions/:qId/answers — Add answer */
  server.post<{
    Params: { spaceId: string; qId: string };
    Body: { label: string; emoji?: string };
  }>(
    "/:spaceId/onboarding/questions/:qId/answers",
    async (request, reply) => {
      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });

      const { spaceId, qId } = request.params;
      const perm = await permissionService.check(spaceId, pubkey, "MANAGE_SPACE");
      if (!perm.allowed) return reply.status(403).send({ error: "Forbidden", code: "FORBIDDEN" });

      const answer = await onboardingService.addAnswer(qId, request.body);
      return { data: answer };
    },
  );

  /** PATCH /:spaceId/onboarding/answers/:aId — Update answer */
  server.patch<{
    Params: { spaceId: string; aId: string };
    Body: { label?: string; emoji?: string | null };
  }>(
    "/:spaceId/onboarding/answers/:aId",
    async (request, reply) => {
      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });

      const { spaceId, aId } = request.params;
      const perm = await permissionService.check(spaceId, pubkey, "MANAGE_SPACE");
      if (!perm.allowed) return reply.status(403).send({ error: "Forbidden", code: "FORBIDDEN" });

      const answer = await onboardingService.updateAnswer(aId, request.body);
      return { data: answer };
    },
  );

  /** DELETE /:spaceId/onboarding/answers/:aId — Delete answer */
  server.delete<{ Params: { spaceId: string; aId: string } }>(
    "/:spaceId/onboarding/answers/:aId",
    async (request, reply) => {
      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });

      const { spaceId, aId } = request.params;
      const perm = await permissionService.check(spaceId, pubkey, "MANAGE_SPACE");
      if (!perm.allowed) return reply.status(403).send({ error: "Forbidden", code: "FORBIDDEN" });

      await onboardingService.deleteAnswer(aId);
      return { data: { success: true } };
    },
  );

  // ── Answer Mappings ─────────────────────────────────────────────

  /** PUT /:spaceId/onboarding/answers/:aId/mappings — Set mappings */
  server.put<{
    Params: { spaceId: string; aId: string };
    Body: { mappings: Array<{ roleId?: string | null; channelId?: string | null }> };
  }>(
    "/:spaceId/onboarding/answers/:aId/mappings",
    async (request, reply) => {
      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });

      const { spaceId, aId } = request.params;
      const perm = await permissionService.check(spaceId, pubkey, "MANAGE_SPACE");
      if (!perm.allowed) return reply.status(403).send({ error: "Forbidden", code: "FORBIDDEN" });

      const mappings = await onboardingService.setAnswerMappings(aId, request.body.mappings);
      return { data: mappings };
    },
  );

  // ── Todo Items ──────────────────────────────────────────────────

  /** POST /:spaceId/onboarding/todos — Create todo */
  server.post<{
    Params: { spaceId: string };
    Body: { title: string; description?: string; linkChannelId?: string };
  }>(
    "/:spaceId/onboarding/todos",
    async (request, reply) => {
      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });

      const { spaceId } = request.params;
      const perm = await permissionService.check(spaceId, pubkey, "MANAGE_SPACE");
      if (!perm.allowed) return reply.status(403).send({ error: "Forbidden", code: "FORBIDDEN" });

      const item = await onboardingService.createTodoItem(spaceId, request.body);
      return { data: item };
    },
  );

  /** PATCH /:spaceId/onboarding/todos/:tId — Update todo */
  server.patch<{
    Params: { spaceId: string; tId: string };
    Body: { title?: string; description?: string | null; linkChannelId?: string | null };
  }>(
    "/:spaceId/onboarding/todos/:tId",
    async (request, reply) => {
      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });

      const { spaceId, tId } = request.params;
      const perm = await permissionService.check(spaceId, pubkey, "MANAGE_SPACE");
      if (!perm.allowed) return reply.status(403).send({ error: "Forbidden", code: "FORBIDDEN" });

      const item = await onboardingService.updateTodoItem(tId, request.body);
      return { data: item };
    },
  );

  /** DELETE /:spaceId/onboarding/todos/:tId — Delete todo */
  server.delete<{ Params: { spaceId: string; tId: string } }>(
    "/:spaceId/onboarding/todos/:tId",
    async (request, reply) => {
      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });

      const { spaceId, tId } = request.params;
      const perm = await permissionService.check(spaceId, pubkey, "MANAGE_SPACE");
      if (!perm.allowed) return reply.status(403).send({ error: "Forbidden", code: "FORBIDDEN" });

      await onboardingService.deleteTodoItem(tId);
      return { data: { success: true } };
    },
  );

  /** POST /:spaceId/onboarding/todos/reorder — Reorder todos */
  server.post<{
    Params: { spaceId: string };
    Body: { orderedIds: string[] };
  }>(
    "/:spaceId/onboarding/todos/reorder",
    async (request, reply) => {
      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });

      const { spaceId } = request.params;
      const perm = await permissionService.check(spaceId, pubkey, "MANAGE_SPACE");
      if (!perm.allowed) return reply.status(403).send({ error: "Forbidden", code: "FORBIDDEN" });

      await onboardingService.reorderTodoItems(spaceId, request.body.orderedIds);
      return { data: { success: true } };
    },
  );

  // ── Member Endpoints ────────────────────────────────────────────

  /** POST /:spaceId/onboarding/submit — Submit onboarding answers */
  server.post<{
    Params: { spaceId: string };
    Body: { answers: Array<{ questionId: string; answerIds: string[] }> };
  }>(
    "/:spaceId/onboarding/submit",
    async (request, reply) => {
      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });

      const { spaceId } = request.params;

      try {
        const result = await onboardingService.submitAnswers(spaceId, pubkey, request.body.answers);
        return { data: result };
      } catch (err: any) {
        return reply.status(400).send({ error: err.message, code: "BAD_REQUEST" });
      }
    },
  );

  /** GET /:spaceId/onboarding/me — Get my onboarding state */
  server.get<{ Params: { spaceId: string } }>(
    "/:spaceId/onboarding/me",
    async (request, reply) => {
      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });

      const { spaceId } = request.params;
      const state = await onboardingService.getMemberState(spaceId, pubkey);
      return {
        data: state
          ? {
              completed: !!state.completedAt,
              answers: state.answers ? JSON.parse(state.answers) : [],
              todoCompleted: state.todoCompleted ? JSON.parse(state.todoCompleted) : [],
            }
          : null,
      };
    },
  );

  /** POST /:spaceId/onboarding/me/todo/:todoId — Complete a todo item */
  server.post<{ Params: { spaceId: string; todoId: string } }>(
    "/:spaceId/onboarding/me/todo/:todoId",
    async (request, reply) => {
      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });

      const { spaceId, todoId } = request.params;
      await onboardingService.completeTodoItem(spaceId, pubkey, todoId);
      return { data: { success: true } };
    },
  );

  // ── Public Endpoints ────────────────────────────────────────────

  /** GET /:spaceId/onboarding/preview — Public preview (no auth) */
  server.get<{ Params: { spaceId: string } }>(
    "/:spaceId/onboarding/preview",
    async (request) => {
      const { spaceId } = request.params;
      const preview = await onboardingService.getOnboardingPreview(spaceId);
      return { data: preview };
    },
  );
};
