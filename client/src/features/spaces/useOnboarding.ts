import { useState, useEffect, useCallback, useRef } from "react";
import type {
  OnboardingConfig,
  OnboardingQuestion,
  OnboardingTodoItem,
} from "@/types/space";
import * as onboardingApi from "@/lib/api/onboarding";

interface UseOnboardingReturn {
  config: OnboardingConfig | null;
  questions: OnboardingQuestion[];
  todoItems: OnboardingTodoItem[];
  isLoading: boolean;
  updateConfig: (params: Partial<Pick<OnboardingConfig, "enabled" | "welcomeMessage" | "welcomeImage" | "requireCompletion">>) => Promise<void>;
  addQuestion: (params: { title: string; description?: string; required?: boolean; multiple?: boolean }) => Promise<void>;
  editQuestion: (questionId: string, params: { title?: string; description?: string | null; required?: boolean; multiple?: boolean }) => Promise<void>;
  removeQuestion: (questionId: string) => Promise<void>;
  addAnswer: (questionId: string, params: { label: string; emoji?: string }) => Promise<void>;
  editAnswer: (answerId: string, params: { label?: string; emoji?: string | null }) => Promise<void>;
  removeAnswer: (answerId: string) => Promise<void>;
  saveMappings: (answerId: string, mappings: Array<{ roleId?: string | null; channelId?: string | null }>) => Promise<void>;
  addTodoItem: (params: { title: string; description?: string; linkChannelId?: string }) => Promise<void>;
  editTodoItem: (todoId: string, params: { title?: string; description?: string | null; linkChannelId?: string | null }) => Promise<void>;
  removeTodoItem: (todoId: string) => Promise<void>;
  refresh: () => void;
}

export function useOnboarding(spaceId: string | null): UseOnboardingReturn {
  const [config, setConfig] = useState<OnboardingConfig | null>(null);
  const [questions, setQuestions] = useState<OnboardingQuestion[]>([]);
  const [todoItems, setTodoItems] = useState<OnboardingTodoItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const fetchedRef = useRef<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!spaceId) return;
    if (fetchedRef.current === spaceId && refreshKey === 0) return;

    let cancelled = false;
    setIsLoading(true);

    async function load() {
      try {
        const res = await onboardingApi.fetchOnboardingConfig(spaceId!);
        if (cancelled) return;
        fetchedRef.current = spaceId;
        setConfig(res.data.config);
        setQuestions(res.data.questions);
        setTodoItems(res.data.todoItems);
      } catch {
        // Backend unavailable
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [spaceId, refreshKey]);

  const refresh = useCallback(() => {
    fetchedRef.current = null;
    setRefreshKey((k) => k + 1);
  }, []);

  const updateConfig = useCallback(
    async (params: Partial<Pick<OnboardingConfig, "enabled" | "welcomeMessage" | "welcomeImage" | "requireCompletion">>) => {
      if (!spaceId) return;
      const res = await onboardingApi.updateOnboardingConfig(spaceId, params);
      setConfig(res.data);
    },
    [spaceId],
  );

  const addQuestion = useCallback(
    async (params: { title: string; description?: string; required?: boolean; multiple?: boolean }) => {
      if (!spaceId) return;
      const res = await onboardingApi.createQuestion(spaceId, params);
      setQuestions((prev) => [...prev, res.data]);
    },
    [spaceId],
  );

  const editQuestion = useCallback(
    async (questionId: string, params: { title?: string; description?: string | null; required?: boolean; multiple?: boolean }) => {
      if (!spaceId) return;
      await onboardingApi.updateQuestion(spaceId, questionId, params);
      setQuestions((prev) =>
        prev.map((q) => (q.id === questionId ? { ...q, ...params } : q)),
      );
    },
    [spaceId],
  );

  const removeQuestion = useCallback(
    async (questionId: string) => {
      if (!spaceId) return;
      await onboardingApi.deleteQuestion(spaceId, questionId);
      setQuestions((prev) => prev.filter((q) => q.id !== questionId));
    },
    [spaceId],
  );

  const addAnswer = useCallback(
    async (questionId: string, params: { label: string; emoji?: string }) => {
      if (!spaceId) return;
      const res = await onboardingApi.createAnswer(spaceId, questionId, params);
      setQuestions((prev) =>
        prev.map((q) =>
          q.id === questionId
            ? { ...q, answers: [...q.answers, res.data] }
            : q,
        ),
      );
    },
    [spaceId],
  );

  const editAnswer = useCallback(
    async (answerId: string, params: { label?: string; emoji?: string | null }) => {
      if (!spaceId) return;
      await onboardingApi.updateAnswer(spaceId, answerId, params);
      setQuestions((prev) =>
        prev.map((q) => ({
          ...q,
          answers: q.answers.map((a) =>
            a.id === answerId ? { ...a, ...params } : a,
          ),
        })),
      );
    },
    [spaceId],
  );

  const removeAnswer = useCallback(
    async (answerId: string) => {
      if (!spaceId) return;
      await onboardingApi.deleteAnswer(spaceId, answerId);
      setQuestions((prev) =>
        prev.map((q) => ({
          ...q,
          answers: q.answers.filter((a) => a.id !== answerId),
        })),
      );
    },
    [spaceId],
  );

  const saveMappings = useCallback(
    async (answerId: string, mappings: Array<{ roleId?: string | null; channelId?: string | null }>) => {
      if (!spaceId) return;
      const res = await onboardingApi.setAnswerMappings(spaceId, answerId, mappings);
      setQuestions((prev) =>
        prev.map((q) => ({
          ...q,
          answers: q.answers.map((a) =>
            a.id === answerId ? { ...a, mappings: res.data } : a,
          ),
        })),
      );
    },
    [spaceId],
  );

  const addTodoItem = useCallback(
    async (params: { title: string; description?: string; linkChannelId?: string }) => {
      if (!spaceId) return;
      const res = await onboardingApi.createTodoItem(spaceId, params);
      setTodoItems((prev) => [...prev, res.data]);
    },
    [spaceId],
  );

  const editTodoItem = useCallback(
    async (todoId: string, params: { title?: string; description?: string | null; linkChannelId?: string | null }) => {
      if (!spaceId) return;
      await onboardingApi.updateTodoItem(spaceId, todoId, params);
      setTodoItems((prev) =>
        prev.map((t) => (t.id === todoId ? { ...t, ...params } : t)),
      );
    },
    [spaceId],
  );

  const removeTodoItem = useCallback(
    async (todoId: string) => {
      if (!spaceId) return;
      await onboardingApi.deleteTodoItem(spaceId, todoId);
      setTodoItems((prev) => prev.filter((t) => t.id !== todoId));
    },
    [spaceId],
  );

  return {
    config,
    questions,
    todoItems,
    isLoading,
    updateConfig,
    addQuestion,
    editQuestion,
    removeQuestion,
    addAnswer,
    editAnswer,
    removeAnswer,
    saveMappings,
    addTodoItem,
    editTodoItem,
    removeTodoItem,
    refresh,
  };
}
