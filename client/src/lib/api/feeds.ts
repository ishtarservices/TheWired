import { api } from "./client";

interface TrendingItem {
  id: string;
  eventId: string;
  period: string;
  kind: number | null;
  score: number;
}

interface PersonalizedItem {
  eventId: string;
  score: number;
}

export async function getTrending(opts?: { period?: string; kind?: number; limit?: number }) {
  const params = new URLSearchParams();
  if (opts?.period) params.set("period", opts.period);
  if (opts?.kind != null) params.set("kind", String(opts.kind));
  if (opts?.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  return api<TrendingItem[]>(`/feeds/trending${qs ? `?${qs}` : ""}`, { auth: false });
}

export async function getPersonalized(opts?: { page?: number; pageSize?: number }) {
  const params = new URLSearchParams();
  if (opts?.page) params.set("page", String(opts.page));
  if (opts?.pageSize) params.set("pageSize", String(opts.pageSize));
  const qs = params.toString();
  return api<PersonalizedItem[]>(`/feeds/personalized${qs ? `?${qs}` : ""}`);
}
