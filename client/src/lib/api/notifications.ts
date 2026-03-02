import { api } from "./client";

export interface ServerNotificationPreferences {
  enabled: boolean;
  mentions: boolean;
  dms: boolean;
  newFollowers: boolean;
  chatMessages: boolean;
  mutedSpaces: string[];
}

/** Fetch the user's notification preferences from the backend. */
export async function getNotificationPreferences(): Promise<ServerNotificationPreferences> {
  const res = await api<ServerNotificationPreferences>("/notifications/preferences");
  return res.data;
}

/** Update the user's notification preferences on the backend. */
export async function updateNotificationPreferences(
  prefs: Partial<ServerNotificationPreferences>,
): Promise<void> {
  await api<{ success: boolean }>("/notifications/preferences", {
    method: "PUT",
    body: prefs,
  });
}
