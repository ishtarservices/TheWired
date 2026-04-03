import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { validate, nonEmptyString } from "../lib/validation.js";
import { onboardingService } from "../services/onboardingService.js";
import { permissionService } from "../services/permissionService.js";

// ── Shared param schemas ──────────────────────────────────────────
const spaceIdParams = z.object({ spaceId: nonEmptyString });
const spaceQIdParams = z.object({ spaceId: nonEmptyString, qId: nonEmptyString });
const spaceAIdParams = z.object({ spaceId: nonEmptyString, aId: nonEmptyString });
const spaceTIdParams = z.object({ spaceId: nonEmptyString, tId: nonEmptyString });
const spaceTodoIdParams = z.object({ spaceId: nonEmptyString, todoId: nonEmptyString });

// ── Body schemas ──────────────────────────────────────────────────
const configBody = z.object({
  enabled: z.boolean().optional(),
  welcomeMessage: z.string().nullable().optional(),
  welcomeImage: z.string().nullable().optional(),
  requireCompletion: z.boolean().optional(),
});

const createQuestionBody = z.object({
  title: nonEmptyString,
  description: z.string().optional(),
  required: z.boolean().optional(),
  multiple: z.boolean().optional(),
});

const updateQuestionBody = z.object({
  title: z.string().optional(),
  description: z.string().nullable().optional(),
  required: z.boolean().optional(),
  multiple: z.boolean().optional(),
});

const createAnswerBody = z.object({
  label: nonEmptyString,
  emoji: z.string().optional(),
});

const updateAnswerBody = z.object({
  label: z.string().optional(),
  emoji: z.string().nullable().optional(),
});

const mappingsBody = z.object({
  mappings: z.array(z.object({
    roleId: z.string().nullable().optional(),
    channelId: z.string().nullable().optional(),
  })),
});

const createTodoBody = z.object({
  title: nonEmptyString,
  description: z.string().optional(),
  linkChannelId: z.string().optional(),
});

const updateTodoBody = z.object({
  title: z.string().optional(),
  description: z.string().nullable().optional(),
  linkChannelId: z.string().nullable().optional(),
});

const reorderBody = z.object({
  orderedIds: z.array(z.string()).min(1),
});

const submitBody = z.object({
  answers: z.array(z.object({
    questionId: nonEmptyString,
    answerIds: z.array(z.string()),
  })),
});

export const onboardingRoutes: FastifyPluginAsync = async (server) => {
  // ── Admin Endpoints (require MANAGE_SPACE) ──────────────────────

  /** GET /:spaceId/onboarding — Full admin view (config + questions + todos) */
  server.get<{ Params: { spaceId: string } }>(
    "/:spaceId/onboarding",
    async (request, reply) => {
      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });

      const params = validate(spaceIdParams, request.params, reply);
      if (!params) return;

      const perm = await permissionService.check(params.spaceId, pubkey, "MANAGE_SPACE");
      if (!perm.allowed) return reply.status(403).send({ error: "Forbidden", code: "FORBIDDEN" });

      const data = await onboardingService.getFullConfig(params.spaceId);
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

      const params = validate(spaceIdParams, request.params, reply);
      if (!params) return;
      const body = validate(configBody, request.body, reply);
      if (!body) return;

      const perm = await permissionService.check(params.spaceId, pubkey, "MANAGE_SPACE");
      if (!perm.allowed) return reply.status(403).send({ error: "Forbidden", code: "FORBIDDEN" });

      const config = await onboardingService.upsertConfig(params.spaceId, body);
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

      const params = validate(spaceIdParams, request.params, reply);
      if (!params) return;
      const body = validate(createQuestionBody, request.body, reply);
      if (!body) return;

      const perm = await permissionService.check(params.spaceId, pubkey, "MANAGE_SPACE");
      if (!perm.allowed) return reply.status(403).send({ error: "Forbidden", code: "FORBIDDEN" });

      const question = await onboardingService.createQuestion(params.spaceId, body);
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

      const params = validate(spaceQIdParams, request.params, reply);
      if (!params) return;
      const body = validate(updateQuestionBody, request.body, reply);
      if (!body) return;

      const perm = await permissionService.check(params.spaceId, pubkey, "MANAGE_SPACE");
      if (!perm.allowed) return reply.status(403).send({ error: "Forbidden", code: "FORBIDDEN" });

      const question = await onboardingService.updateQuestion(params.qId, body);
      return { data: question };
    },
  );

  /** DELETE /:spaceId/onboarding/questions/:qId — Delete question */
  server.delete<{ Params: { spaceId: string; qId: string } }>(
    "/:spaceId/onboarding/questions/:qId",
    async (request, reply) => {
      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });

      const params = validate(spaceQIdParams, request.params, reply);
      if (!params) return;

      const perm = await permissionService.check(params.spaceId, pubkey, "MANAGE_SPACE");
      if (!perm.allowed) return reply.status(403).send({ error: "Forbidden", code: "FORBIDDEN" });

      await onboardingService.deleteQuestion(params.qId);
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

      const params = validate(spaceIdParams, request.params, reply);
      if (!params) return;
      const body = validate(reorderBody, request.body, reply);
      if (!body) return;

      const perm = await permissionService.check(params.spaceId, pubkey, "MANAGE_SPACE");
      if (!perm.allowed) return reply.status(403).send({ error: "Forbidden", code: "FORBIDDEN" });

      await onboardingService.reorderQuestions(params.spaceId, body.orderedIds);
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

      const params = validate(spaceQIdParams, request.params, reply);
      if (!params) return;
      const body = validate(createAnswerBody, request.body, reply);
      if (!body) return;

      const perm = await permissionService.check(params.spaceId, pubkey, "MANAGE_SPACE");
      if (!perm.allowed) return reply.status(403).send({ error: "Forbidden", code: "FORBIDDEN" });

      const answer = await onboardingService.addAnswer(params.qId, body);
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

      const params = validate(spaceAIdParams, request.params, reply);
      if (!params) return;
      const body = validate(updateAnswerBody, request.body, reply);
      if (!body) return;

      const perm = await permissionService.check(params.spaceId, pubkey, "MANAGE_SPACE");
      if (!perm.allowed) return reply.status(403).send({ error: "Forbidden", code: "FORBIDDEN" });

      const answer = await onboardingService.updateAnswer(params.aId, body);
      return { data: answer };
    },
  );

  /** DELETE /:spaceId/onboarding/answers/:aId — Delete answer */
  server.delete<{ Params: { spaceId: string; aId: string } }>(
    "/:spaceId/onboarding/answers/:aId",
    async (request, reply) => {
      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });

      const params = validate(spaceAIdParams, request.params, reply);
      if (!params) return;

      const perm = await permissionService.check(params.spaceId, pubkey, "MANAGE_SPACE");
      if (!perm.allowed) return reply.status(403).send({ error: "Forbidden", code: "FORBIDDEN" });

      await onboardingService.deleteAnswer(params.aId);
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

      const params = validate(spaceAIdParams, request.params, reply);
      if (!params) return;
      const body = validate(mappingsBody, request.body, reply);
      if (!body) return;

      const perm = await permissionService.check(params.spaceId, pubkey, "MANAGE_SPACE");
      if (!perm.allowed) return reply.status(403).send({ error: "Forbidden", code: "FORBIDDEN" });

      const mappings = await onboardingService.setAnswerMappings(params.aId, body.mappings);
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

      const params = validate(spaceIdParams, request.params, reply);
      if (!params) return;
      const body = validate(createTodoBody, request.body, reply);
      if (!body) return;

      const perm = await permissionService.check(params.spaceId, pubkey, "MANAGE_SPACE");
      if (!perm.allowed) return reply.status(403).send({ error: "Forbidden", code: "FORBIDDEN" });

      const item = await onboardingService.createTodoItem(params.spaceId, body);
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

      const params = validate(spaceTIdParams, request.params, reply);
      if (!params) return;
      const body = validate(updateTodoBody, request.body, reply);
      if (!body) return;

      const perm = await permissionService.check(params.spaceId, pubkey, "MANAGE_SPACE");
      if (!perm.allowed) return reply.status(403).send({ error: "Forbidden", code: "FORBIDDEN" });

      const item = await onboardingService.updateTodoItem(params.tId, body);
      return { data: item };
    },
  );

  /** DELETE /:spaceId/onboarding/todos/:tId — Delete todo */
  server.delete<{ Params: { spaceId: string; tId: string } }>(
    "/:spaceId/onboarding/todos/:tId",
    async (request, reply) => {
      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });

      const params = validate(spaceTIdParams, request.params, reply);
      if (!params) return;

      const perm = await permissionService.check(params.spaceId, pubkey, "MANAGE_SPACE");
      if (!perm.allowed) return reply.status(403).send({ error: "Forbidden", code: "FORBIDDEN" });

      await onboardingService.deleteTodoItem(params.tId);
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

      const params = validate(spaceIdParams, request.params, reply);
      if (!params) return;
      const body = validate(reorderBody, request.body, reply);
      if (!body) return;

      const perm = await permissionService.check(params.spaceId, pubkey, "MANAGE_SPACE");
      if (!perm.allowed) return reply.status(403).send({ error: "Forbidden", code: "FORBIDDEN" });

      await onboardingService.reorderTodoItems(params.spaceId, body.orderedIds);
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

      const params = validate(spaceIdParams, request.params, reply);
      if (!params) return;
      const body = validate(submitBody, request.body, reply);
      if (!body) return;

      try {
        const result = await onboardingService.submitAnswers(params.spaceId, pubkey, body.answers);
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

      const params = validate(spaceIdParams, request.params, reply);
      if (!params) return;

      const state = await onboardingService.getMemberState(params.spaceId, pubkey);
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

      const params = validate(spaceTodoIdParams, request.params, reply);
      if (!params) return;

      await onboardingService.completeTodoItem(params.spaceId, pubkey, params.todoId);
      return { data: { success: true } };
    },
  );

  // ── Public Endpoints ────────────────────────────────────────────

  /** GET /:spaceId/onboarding/preview — Public preview (no auth) */
  server.get<{ Params: { spaceId: string } }>(
    "/:spaceId/onboarding/preview",
    async (request, reply) => {
      const params = validate(spaceIdParams, request.params, reply);
      if (!params) return;

      const preview = await onboardingService.getOnboardingPreview(params.spaceId);
      return { data: preview };
    },
  );
};
