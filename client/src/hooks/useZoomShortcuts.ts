import { useEffect } from "react";
import { decreaseZoom, increaseZoom, resetZoom } from "../lib/zoom";

/**
 * Browser-style zoom shortcuts: Cmd/Ctrl + (+/=), -, 0.
 * Active app-wide; fires inside inputs too (matches native browser behavior).
 */
export function useZoomShortcuts() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Require exactly the platform mod key. Reject Alt/Shift combos so we
      // don't swallow other apps' shortcuts (e.g. Cmd+Shift+= in some IDEs).
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.altKey) return;

      switch (e.key) {
        case "+":
        case "=":
          e.preventDefault();
          increaseZoom();
          break;
        case "-":
        case "_":
          e.preventDefault();
          decreaseZoom();
          break;
        case "0":
          e.preventDefault();
          resetZoom();
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}
