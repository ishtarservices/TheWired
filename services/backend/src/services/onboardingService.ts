import { nanoid } from "../lib/id.js";
import { db } from "../db/connection.js";
import {
  onboardingConfig,
  onboardingQuestions,
  onboardingAnswers,
  onboardingAnswerMappings,
  onboardingTodoItems,
  memberOnboardingState,
} from "../db/schema/onboarding.js";
import { eq, and, asc, inArray } from "drizzle-orm";
import { roleService } from "./roleService.js";

// ── Types ───────────────────────────────────────────────────────────

interface UpsertConfigParams {
  enabled?: boolean;
  welcomeMessage?: string | null;
  welcomeImage?: string | null;
  requireCompletion?: boolean;
}

interface CreateQuestionParams {
  title: string;
  description?: string;
  required?: boolean;
  multiple?: boolean;
}

interface UpdateQuestionParams {
  title?: string;
  description?: string | null;
  required?: boolean;
  multiple?: boolean;
}

interface CreateAnswerParams {
  label: string;
  emoji?: string;
}

interface MappingInput {
  roleId?: string | null;
  channelId?: string | null;
}

interface CreateTodoParams {
  title: string;
  description?: string;
  linkChannelId?: string;
}

interface SubmittedAnswer {
  questionId: string;
  answerIds: string[];
}

// ── Service ─────────────────────────────────────────────────────────

export const onboardingService = {
  // ── Config ──────────────────────────────────────────────────────

  async getConfig(spaceId: string) {
    const [row] = await db
      .select()
      .from(onboardingConfig)
      .where(eq(onboardingConfig.spaceId, spaceId))
      .limit(1);
    return row ?? null;
  },

  async upsertConfig(spaceId: string, params: UpsertConfigParams) {
    const existing = await this.getConfig(spaceId);

    if (existing) {
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (params.enabled !== undefined) updates.enabled = params.enabled;
      if (params.welcomeMessage !== undefined) updates.welcomeMessage = params.welcomeMessage;
      if (params.welcomeImage !== undefined) updates.welcomeImage = params.welcomeImage;
      if (params.requireCompletion !== undefined) updates.requireCompletion = params.requireCompletion;

      await db
        .update(onboardingConfig)
        .set(updates)
        .where(eq(onboardingConfig.spaceId, spaceId));
    } else {
      await db.insert(onboardingConfig).values({
        spaceId,
        enabled: params.enabled ?? false,
        welcomeMessage: params.welcomeMessage ?? null,
        welcomeImage: params.welcomeImage ?? null,
        requireCompletion: params.requireCompletion ?? false,
      });
    }

    return this.getConfig(spaceId);
  },

  // ── Questions ───────────────────────────────────────────────────

  async listQuestions(spaceId: string) {
    const questions = await db
      .select()
      .from(onboardingQuestions)
      .where(eq(onboardingQuestions.spaceId, spaceId))
      .orderBy(asc(onboardingQuestions.position));

    const result = [];
    for (const q of questions) {
      const answers = await db
        .select()
        .from(onboardingAnswers)
        .where(eq(onboardingAnswers.questionId, q.id))
        .orderBy(asc(onboardingAnswers.position));

      const answersWithMappings = [];
      for (const a of answers) {
        const mappings = await db
          .select()
          .from(onboardingAnswerMappings)
          .where(eq(onboardingAnswerMappings.answerId, a.id));
        answersWithMappings.push({ ...a, mappings });
      }

      result.push({ ...q, answers: answersWithMappings });
    }
    return result;
  },

  async createQuestion(spaceId: string, params: CreateQuestionParams) {
    const existing = await db
      .select()
      .from(onboardingQuestions)
      .where(eq(onboardingQuestions.spaceId, spaceId));
    const nextPosition = existing.length;

    const id = nanoid(12);
    const [question] = await db
      .insert(onboardingQuestions)
      .values({
        id,
        spaceId,
        title: params.title,
        description: params.description ?? null,
        position: nextPosition,
        required: params.required ?? false,
        multiple: params.multiple ?? false,
      })
      .returning();

    return { ...question, answers: [] };
  },

  async updateQuestion(questionId: string, params: UpdateQuestionParams) {
    const updates: Record<string, unknown> = {};
    if (params.title !== undefined) updates.title = params.title;
    if (params.description !== undefined) updates.description = params.description;
    if (params.required !== undefined) updates.required = params.required;
    if (params.multiple !== undefined) updates.multiple = params.multiple;

    if (Object.keys(updates).length > 0) {
      await db
        .update(onboardingQuestions)
        .set(updates)
        .where(eq(onboardingQuestions.id, questionId));
    }

    const [question] = await db
      .select()
      .from(onboardingQuestions)
      .where(eq(onboardingQuestions.id, questionId))
      .limit(1);
    return question;
  },

  async deleteQuestion(questionId: string) {
    await db.delete(onboardingQuestions).where(eq(onboardingQuestions.id, questionId));
  },

  async reorderQuestions(spaceId: string, orderedIds: string[]) {
    for (let i = 0; i < orderedIds.length; i++) {
      await db
        .update(onboardingQuestions)
        .set({ position: i })
        .where(and(eq(onboardingQuestions.id, orderedIds[i]), eq(onboardingQuestions.spaceId, spaceId)));
    }
  },

  // ── Answers ─────────────────────────────────────────────────────

  async addAnswer(questionId: string, params: CreateAnswerParams) {
    const existing = await db
      .select()
      .from(onboardingAnswers)
      .where(eq(onboardingAnswers.questionId, questionId));
    const nextPosition = existing.length;

    const id = nanoid(12);
    const [answer] = await db
      .insert(onboardingAnswers)
      .values({
        id,
        questionId,
        label: params.label,
        emoji: params.emoji ?? null,
        position: nextPosition,
      })
      .returning();

    return { ...answer, mappings: [] };
  },

  async updateAnswer(answerId: string, params: { label?: string; emoji?: string | null }) {
    const updates: Record<string, unknown> = {};
    if (params.label !== undefined) updates.label = params.label;
    if (params.emoji !== undefined) updates.emoji = params.emoji;

    if (Object.keys(updates).length > 0) {
      await db
        .update(onboardingAnswers)
        .set(updates)
        .where(eq(onboardingAnswers.id, answerId));
    }

    const [answer] = await db
      .select()
      .from(onboardingAnswers)
      .where(eq(onboardingAnswers.id, answerId))
      .limit(1);
    return answer;
  },

  async deleteAnswer(answerId: string) {
    await db.delete(onboardingAnswers).where(eq(onboardingAnswers.id, answerId));
  },

  async reorderAnswers(questionId: string, orderedIds: string[]) {
    for (let i = 0; i < orderedIds.length; i++) {
      await db
        .update(onboardingAnswers)
        .set({ position: i })
        .where(and(eq(onboardingAnswers.id, orderedIds[i]), eq(onboardingAnswers.questionId, questionId)));
    }
  },

  // ── Answer Mappings ─────────────────────────────────────────────

  async setAnswerMappings(answerId: string, mappings: MappingInput[]) {
    // Replace all mappings for this answer
    await db.delete(onboardingAnswerMappings).where(eq(onboardingAnswerMappings.answerId, answerId));

    const values = mappings
      .filter((m) => m.roleId || m.channelId)
      .map((m) => ({
        id: nanoid(12),
        answerId,
        roleId: m.roleId ?? null,
        channelId: m.channelId ?? null,
      }));

    if (values.length > 0) {
      await db.insert(onboardingAnswerMappings).values(values);
    }

    return db
      .select()
      .from(onboardingAnswerMappings)
      .where(eq(onboardingAnswerMappings.answerId, answerId));
  },

  // ── Todo Items ──────────────────────────────────────────────────

  async listTodoItems(spaceId: string) {
    return db
      .select()
      .from(onboardingTodoItems)
      .where(eq(onboardingTodoItems.spaceId, spaceId))
      .orderBy(asc(onboardingTodoItems.position));
  },

  async createTodoItem(spaceId: string, params: CreateTodoParams) {
    const existing = await db
      .select()
      .from(onboardingTodoItems)
      .where(eq(onboardingTodoItems.spaceId, spaceId));
    const nextPosition = existing.length;

    const id = nanoid(12);
    const [item] = await db
      .insert(onboardingTodoItems)
      .values({
        id,
        spaceId,
        title: params.title,
        description: params.description ?? null,
        linkChannelId: params.linkChannelId ?? null,
        position: nextPosition,
      })
      .returning();

    return item;
  },

  async updateTodoItem(todoId: string, params: { title?: string; description?: string | null; linkChannelId?: string | null }) {
    const updates: Record<string, unknown> = {};
    if (params.title !== undefined) updates.title = params.title;
    if (params.description !== undefined) updates.description = params.description;
    if (params.linkChannelId !== undefined) updates.linkChannelId = params.linkChannelId;

    if (Object.keys(updates).length > 0) {
      await db.update(onboardingTodoItems).set(updates).where(eq(onboardingTodoItems.id, todoId));
    }

    const [item] = await db.select().from(onboardingTodoItems).where(eq(onboardingTodoItems.id, todoId)).limit(1);
    return item;
  },

  async deleteTodoItem(todoId: string) {
    await db.delete(onboardingTodoItems).where(eq(onboardingTodoItems.id, todoId));
  },

  async reorderTodoItems(spaceId: string, orderedIds: string[]) {
    for (let i = 0; i < orderedIds.length; i++) {
      await db
        .update(onboardingTodoItems)
        .set({ position: i })
        .where(and(eq(onboardingTodoItems.id, orderedIds[i]), eq(onboardingTodoItems.spaceId, spaceId)));
    }
  },

  // ── Member Onboarding State ─────────────────────────────────────

  async getMemberState(spaceId: string, pubkey: string) {
    const [row] = await db
      .select()
      .from(memberOnboardingState)
      .where(and(eq(memberOnboardingState.spaceId, spaceId), eq(memberOnboardingState.pubkey, pubkey)))
      .limit(1);
    return row ?? null;
  },

  async completeTodoItem(spaceId: string, pubkey: string, todoItemId: string) {
    const state = await this.getMemberState(spaceId, pubkey);
    const existing: string[] = state?.todoCompleted ? JSON.parse(state.todoCompleted) : [];

    if (!existing.includes(todoItemId)) {
      existing.push(todoItemId);
    }

    const todoCompleted = JSON.stringify(existing);

    if (state) {
      await db
        .update(memberOnboardingState)
        .set({ todoCompleted })
        .where(and(eq(memberOnboardingState.spaceId, spaceId), eq(memberOnboardingState.pubkey, pubkey)));
    } else {
      await db.insert(memberOnboardingState).values({
        spaceId,
        pubkey,
        todoCompleted,
      });
    }
  },

  // ── Submit Answers (core onboarding logic) ──────────────────────

  async submitAnswers(spaceId: string, pubkey: string, answers: SubmittedAnswer[]) {
    // 1. Fetch all questions for this space
    const questions = await db
      .select()
      .from(onboardingQuestions)
      .where(eq(onboardingQuestions.spaceId, spaceId));

    const questionMap = new Map(questions.map((q) => [q.id, q]));

    // 2. Validate all required questions are answered
    for (const q of questions) {
      if (q.required) {
        const submitted = answers.find((a) => a.questionId === q.id);
        if (!submitted || submitted.answerIds.length === 0) {
          throw new Error(`Required question "${q.title}" was not answered`);
        }
      }
    }

    // 3. Validate answer IDs belong to the correct questions
    const allAnswerIds = answers.flatMap((a) => a.answerIds);
    if (allAnswerIds.length === 0) {
      // No answers selected — just mark as complete
      await this._saveState(spaceId, pubkey, answers, true);
      return { assignedRoles: [], completed: true };
    }

    const validAnswers = await db
      .select()
      .from(onboardingAnswers)
      .where(inArray(onboardingAnswers.id, allAnswerIds));

    const validAnswerIds = new Set(validAnswers.map((a) => a.id));
    for (const id of allAnswerIds) {
      if (!validAnswerIds.has(id)) {
        throw new Error(`Invalid answer ID: ${id}`);
      }
    }

    // Validate single-select questions don't have multiple answers
    for (const answer of answers) {
      const question = questionMap.get(answer.questionId);
      if (question && !question.multiple && answer.answerIds.length > 1) {
        throw new Error(`Question "${question.title}" only allows a single answer`);
      }
    }

    // 4. Resolve answer mappings
    const mappings = await db
      .select()
      .from(onboardingAnswerMappings)
      .where(inArray(onboardingAnswerMappings.answerId, allAnswerIds));

    // 5. Assign roles
    const roleIds = [...new Set(mappings.filter((m) => m.roleId).map((m) => m.roleId!))];
    for (const roleId of roleIds) {
      await roleService.assignRole(spaceId, pubkey, roleId);
    }

    // 6. Save member state
    const allRequired = questions.filter((q) => q.required);
    const allRequiredAnswered = allRequired.every((q) =>
      answers.some((a) => a.questionId === q.id && a.answerIds.length > 0),
    );
    await this._saveState(spaceId, pubkey, answers, allRequiredAnswered);

    return { assignedRoles: roleIds, completed: allRequiredAnswered };
  },

  async _saveState(spaceId: string, pubkey: string, answers: SubmittedAnswer[], completed: boolean) {
    const answersJson = JSON.stringify(answers);
    const existing = await this.getMemberState(spaceId, pubkey);

    if (existing) {
      await db
        .update(memberOnboardingState)
        .set({
          answers: answersJson,
          completedAt: completed ? new Date() : null,
        })
        .where(and(eq(memberOnboardingState.spaceId, spaceId), eq(memberOnboardingState.pubkey, pubkey)));
    } else {
      await db.insert(memberOnboardingState).values({
        spaceId,
        pubkey,
        answers: answersJson,
        completedAt: completed ? new Date() : null,
      });
    }
  },

  // ── Public Preview (no auth) ────────────────────────────────────

  async getOnboardingPreview(spaceId: string) {
    const config = await this.getConfig(spaceId);
    if (!config || !config.enabled) return null;

    const questions = await db
      .select()
      .from(onboardingQuestions)
      .where(eq(onboardingQuestions.spaceId, spaceId))
      .orderBy(asc(onboardingQuestions.position));

    const questionsWithAnswers = [];
    for (const q of questions) {
      const answers = await db
        .select({
          id: onboardingAnswers.id,
          label: onboardingAnswers.label,
          emoji: onboardingAnswers.emoji,
          position: onboardingAnswers.position,
        })
        .from(onboardingAnswers)
        .where(eq(onboardingAnswers.questionId, q.id))
        .orderBy(asc(onboardingAnswers.position));

      questionsWithAnswers.push({
        id: q.id,
        title: q.title,
        description: q.description,
        required: q.required,
        multiple: q.multiple,
        position: q.position,
        answers,
      });
    }

    const todoItems = await this.listTodoItems(spaceId);

    return {
      welcomeMessage: config.welcomeMessage,
      welcomeImage: config.welcomeImage,
      requireCompletion: config.requireCompletion,
      questions: questionsWithAnswers,
      todoItems,
    };
  },

  // ── Full Admin View ─────────────────────────────────────────────

  async getFullConfig(spaceId: string) {
    const config = await this.getConfig(spaceId);
    const questions = await this.listQuestions(spaceId);
    const todoItems = await this.listTodoItems(spaceId);

    return {
      config: config ?? {
        spaceId,
        enabled: false,
        welcomeMessage: null,
        welcomeImage: null,
        requireCompletion: false,
        updatedAt: null,
      },
      questions,
      todoItems,
    };
  },
};
