// App-wide minute tick for relative timestamps. One interval (mounted once in
// App.tsx); rows subscribe via a memo'd leaf (NoteTimestamp) so a tick
// re-renders only the timestamp Text, never the memo'd cards around it.

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { AppState } from "react-native";

export function currentMinute(): number {
  return Math.floor(Date.now() / 60_000);
}

export const TimeTickContext = createContext<number>(currentMinute());

export function TimeTickProvider({ children }: { children: ReactNode }) {
  const [minute, setMinute] = useState(currentMinute);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    // Align to the next minute boundary, then tick every 60s.
    const boundary = setTimeout(
      () => {
        setMinute(currentMinute());
        interval = setInterval(() => setMinute(currentMinute()), 60_000);
      },
      60_000 - (Date.now() % 60_000),
    );
    // Timers drift/pause while suspended — re-sync on return to foreground.
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") setMinute(currentMinute());
    });
    return () => {
      clearTimeout(boundary);
      if (interval) clearInterval(interval);
      sub.remove();
    };
  }, []);

  return <TimeTickContext.Provider value={minute}>{children}</TimeTickContext.Provider>;
}

export function useMinuteTick(): number {
  return useContext(TimeTickContext);
}
