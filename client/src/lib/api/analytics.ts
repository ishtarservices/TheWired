import { api } from "./client";

interface SpaceAnalytics {
  spaceId: string;
  period: string;
  dailyActivity: {
    spaceId: string;
    date: string;
    messageCount: number;
    uniqueAuthors: number;
    newMembers: number;
    leftMembers: number;
  }[];
}

export async function getSpaceAnalytics(spaceId: string, period?: string) {
  const params = new URLSearchParams();
  if (period) params.set("period", period);
  const qs = params.toString();
  return api<SpaceAnalytics>(`/analytics/spaces/${encodeURIComponent(spaceId)}${qs ? `?${qs}` : ""}`);
}
