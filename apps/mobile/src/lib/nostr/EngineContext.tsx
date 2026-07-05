import { createContext, useContext, type ReactNode } from "react";

import type { NostrEngine } from "./engine";

// The engine is created once in App.tsx (next to the store) and handed to
// screens through context — no module-level singleton, same DI posture as
// createStore(adapters).

const EngineContext = createContext<NostrEngine | null>(null);

export function EngineProvider({
  engine,
  children,
}: {
  engine: NostrEngine;
  children: ReactNode;
}) {
  return <EngineContext.Provider value={engine}>{children}</EngineContext.Provider>;
}

export function useEngine(): NostrEngine {
  const engine = useContext(EngineContext);
  if (!engine) throw new Error("useEngine must be used within EngineProvider");
  return engine;
}
