import { useState, useEffect, useCallback, useRef } from "react";

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "up-to-date"
  | "error";

interface UpdateState {
  status: UpdateStatus;
  version: string | null;
  error: string | null;
  progress: number | null;
}

export function useAppUpdater(checkOnMount = true, autoDownload = false) {
  const [state, setState] = useState<UpdateState>({
    status: "idle",
    version: null,
    error: null,
    progress: null,
  });
  const autoDownloadTriggered = useRef(false);

  const checkForUpdate = useCallback(async () => {
    if (!isTauri) return;

    setState((s) => ({ ...s, status: "checking", error: null }));

    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();

      if (update) {
        setState((s) => ({
          ...s,
          status: "available",
          version: update.version,
        }));
      } else {
        setState((s) => ({ ...s, status: "up-to-date" }));
      }
    } catch (err) {
      setState((s) => ({
        ...s,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, []);

  const downloadAndInstall = useCallback(async () => {
    if (!isTauri) return;

    setState((s) => ({ ...s, status: "downloading", progress: 0 }));

    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (!update) return;

      let totalLength = 0;
      let downloaded = 0;

      await update.downloadAndInstall((event) => {
        if (event.event === "Started" && event.data.contentLength) {
          totalLength = event.data.contentLength;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (totalLength > 0) {
            setState((s) => ({
              ...s,
              progress: Math.round((downloaded / totalLength) * 100),
            }));
          }
        } else if (event.event === "Finished") {
          setState((s) => ({ ...s, status: "ready", progress: 100 }));
        }
      });

      setState((s) => ({ ...s, status: "ready", progress: 100 }));
    } catch (err) {
      setState((s) => ({
        ...s,
        status: "error",
        error: err instanceof Error ? err.message : "Download failed",
      }));
    }
  }, []);

  const relaunch = useCallback(async () => {
    try {
      const { relaunch: tauriRelaunch } = await import("@tauri-apps/plugin-process");
      await tauriRelaunch();
    } catch {
      // Fallback: exit the app
      const { exit } = await import("@tauri-apps/plugin-process");
      await exit(0);
    }
  }, []);

  useEffect(() => {
    if (checkOnMount) {
      checkForUpdate();
    }
  }, [checkOnMount, checkForUpdate]);

  // Auto-download when an update is found and autoDownload is enabled
  useEffect(() => {
    if (autoDownload && state.status === "available" && !autoDownloadTriggered.current) {
      autoDownloadTriggered.current = true;
      downloadAndInstall();
    }
  }, [autoDownload, state.status, downloadAndInstall]);

  // Auto-relaunch when download completes and autoDownload is enabled
  useEffect(() => {
    if (autoDownload && state.status === "ready") {
      const timer = setTimeout(() => relaunch(), 1500);
      return () => clearTimeout(timer);
    }
  }, [autoDownload, state.status, relaunch]);

  return { ...state, checkForUpdate, downloadAndInstall, relaunch };
}
