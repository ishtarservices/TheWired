/** Request browser notification permission. Returns true if granted. */
export async function requestBrowserPermission(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;

  const result = await Notification.requestPermission();
  return result === "granted";
}

/** Show a browser/OS notification. Only fires when app is not focused. */
export function showBrowserNotification(title: string, body: string): void {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  if (document.hasFocus()) return;

  try {
    new Notification(title, {
      body,
      icon: "/favicon.svg",
      tag: `wired-${Date.now()}`,
    });
  } catch {
    // Notification constructor may fail in some environments
  }
}
