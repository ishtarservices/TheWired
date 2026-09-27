// The LiveKit frame-cryptor worker (AES-GCM per encoded frame + data
// packet). Isolated in its own module so tests can `vi.mock` it and so the
// Vite `?worker` import keeps the worker as a separate chunk, outside the
// main bundle. The Tauri CSP already allows same-origin + blob workers.
import E2EEWorker from "livekit-client/e2ee-worker?worker";

export function createE2EEWorker(): Worker {
  return new E2EEWorker();
}
