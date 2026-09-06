import { isTauri } from "./platform";

/**
 * Toggle true window fullscreen. In Tauri this drives the native window
 * (the meeting-notes ask: "video call on full screen, Windows"); on the web
 * it falls back to the Fullscreen API on the document.
 */
export async function toggleWindowFullscreen(): Promise<boolean> {
  if (isTauri) {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      const next = !(await win.isFullscreen());
      await win.setFullscreen(next);
      return next;
    } catch (err) {
      console.warn("[window] fullscreen toggle failed:", err);
      return false;
    }
  }
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return false;
    }
    await document.documentElement.requestFullscreen();
    return true;
  } catch {
    return false;
  }
}

export async function isWindowFullscreen(): Promise<boolean> {
  if (isTauri) {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      return await getCurrentWindow().isFullscreen();
    } catch {
      return false;
    }
  }
  return !!document.fullscreenElement;
}
