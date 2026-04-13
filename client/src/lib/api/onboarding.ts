import { api } from "./client";
import type {
  OnboardingConfig,
  OnboardingQuestion,
  OnboardingAnswer,
  AnswerMapping,
  OnboardingTodoItem,
  MemberOnboardingState,
  OnboardingPreview,
  OnboardingFullConfig,
} from "@/types/space";

// ── Admin APIs ────────────────────────────────────────────────────

export async function fetchOnboardingConfig(spaceId: string) {
  return api<OnboardingFullConfig>(`/spaces/${encodeURIComponent(spaceId)}/onboarding`);
}

export async function updateOnboardingConfig(
  spaceId: string,
  config: Partial<Pick<OnboardingConfig, "enabled" | "welcomeMessage" | "welcomeImage" | "requireCompletion">>,
) {
  return api<OnboardingConfig>(`/spaces/${encodeURIComponent(spaceId)}/onboarding/config`, {
    method: "PUT",
    body: config,
  });
}

// ── Questions ─────────────────────────────────────────────────────

export async function createQuestion(
  spaceId: string,
  params: { title: string; description?: string; required?: boolean; multiple?: boolean },
) {
  return api<OnboardingQuestion>(`/spaces/${encodeURIComponent(spaceId)}/onboarding/questions`, {
    method: "POST",
    body: params,
  });
}

export async function updateQuestion(
  spaceId: string,
  questionId: string,
  params: { title?: string; description?: string | null; required?: boolean; multiple?: boolean },
) {
  return api<OnboardingQuestion>(
    `/spaces/${encodeURIComponent(spaceId)}/onboarding/questions/${encodeURIComponent(questionId)}`,
    { method: "PATCH", body: params },
  );
}

export async function deleteQuestion(spaceId: string, questionId: string) {
  return api<{ success: boolean }>(
    `/spaces/${encodeURIComponent(spaceId)}/onboarding/questions/${encodeURIComponent(questionId)}`,
    { method: "DELETE" },
  );
}

export async function reorderQuestions(spaceId: string, orderedIds: string[]) {
  return api<{ success: boolean }>(
    `/spaces/${encodeURIComponent(spaceId)}/onboarding/questions/reorder`,
    { method: "POST", body: { orderedIds } },
  );
}

// ── Answers ───────────────────────────────────────────────────────

export async function createAnswer(
  spaceId: string,
  questionId: string,
  params: { label: string; emoji?: string },
) {
  return api<OnboardingAnswer>(
    `/spaces/${encodeURIComponent(spaceId)}/onboarding/questions/${encodeURIComponent(questionId)}/answers`,
    { method: "POST", body: params },
  );
}

export async function updateAnswer(
  spaceId: string,
  answerId: string,
  params: { label?: string; emoji?: string | null },
) {
  return api<OnboardingAnswer>(
    `/spaces/${encodeURIComponent(spaceId)}/onboarding/answers/${encodeURIComponent(answerId)}`,
    { method: "PATCH", body: params },
  );
}

export async function deleteAnswer(spaceId: string, answerId: string) {
  return api<{ success: boolean }>(
    `/spaces/${encodeURIComponent(spaceId)}/onboarding/answers/${encodeURIComponent(answerId)}`,
    { method: "DELETE" },
  );
}

// ── Answer Mappings ───────────────────────────────────────────────

export async function setAnswerMappings(
  spaceId: string,
  answerId: string,
  mappings: Array<{ roleId?: string | null; channelId?: string | null }>,
) {
  return api<AnswerMapping[]>(
    `/spaces/${encodeURIComponent(spaceId)}/onboarding/answers/${encodeURIComponent(answerId)}/mappings`,
    { method: "PUT", body: { mappings } },
  );
}

// ── Todo Items ────────────────────────────────────────────────────

export async function createTodoItem(
  spaceId: string,
  params: { title: string; description?: string; linkChannelId?: string },
) {
  return api<OnboardingTodoItem>(`/spaces/${encodeURIComponent(spaceId)}/onboarding/todos`, {
    method: "POST",
    body: params,
  });
}

export async function updateTodoItem(
  spaceId: string,
  todoId: string,
  params: { title?: string; description?: string | null; linkChannelId?: string | null },
) {
  return api<OnboardingTodoItem>(
    `/spaces/${encodeURIComponent(spaceId)}/onboarding/todos/${encodeURIComponent(todoId)}`,
    { method: "PATCH", body: params },
  );
}

export async function deleteTodoItem(spaceId: string, todoId: string) {
  return api<{ success: boolean }>(
    `/spaces/${encodeURIComponent(spaceId)}/onboarding/todos/${encodeURIComponent(todoId)}`,
    { method: "DELETE" },
  );
}

export async function reorderTodoItems(spaceId: string, orderedIds: string[]) {
  return api<{ success: boolean }>(
    `/spaces/${encodeURIComponent(spaceId)}/onboarding/todos/reorder`,
    { method: "POST", body: { orderedIds } },
  );
}

// ── Member APIs ───────────────────────────────────────────────────

export async function submitOnboarding(
  spaceId: string,
  answers: Array<{ questionId: string; answerIds: string[] }>,
) {
  return api<{ assignedRoles: string[]; completed: boolean }>(
    `/spaces/${encodeURIComponent(spaceId)}/onboarding/submit`,
    { method: "POST", body: { answers } },
  );
}

export async function fetchMyOnboardingState(spaceId: string) {
  return api<MemberOnboardingState | null>(
    `/spaces/${encodeURIComponent(spaceId)}/onboarding/me`,
    { priority: "low" },
  );
}

export async function completeTodoItem(spaceId: string, todoId: string) {
  return api<{ success: boolean }>(
    `/spaces/${encodeURIComponent(spaceId)}/onboarding/me/todo/${encodeURIComponent(todoId)}`,
    { method: "POST" },
  );
}

// ── Public API ────────────────────────────────────────────────────

export async function fetchOnboardingPreview(spaceId: string) {
  return api<OnboardingPreview | null>(
    `/spaces/${encodeURIComponent(spaceId)}/onboarding/preview`,
    { auth: false, priority: "low" },
  );
}
