import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { store } from "./store";
import App from "./app/App";
import { initZoom } from "./lib/zoom";
import { installWiredDebug } from "./lib/debug/logger";
import { startPerfMonitor } from "./lib/debug/perfMonitor";
import "./index.css";

// Apply persisted zoom synchronously before render to avoid layout flash.
initZoom();

// Diagnostic logging is OFF by default (warn/error still print). Install the
// console API and, in dev, drop a single discovery hint. Turn it on when needed
// with wiredDebug.enable("profile,relay,…"); wiredDebug.help() lists everything.
installWiredDebug();
// Main-thread lag monitor runs always: warn-level events still print even when
// the rest of debug logging is off, so user-visible UI freezes are always surfaced.
startPerfMonitor();
if (import.meta.env.DEV) {
  // eslint-disable-next-line no-console
  console.info(
    "%c[wiredDebug]%c logging off by default — wiredDebug.help() to enable category logs",
    "color:#a78bfa;font-weight:600",
    "color:inherit",
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </React.StrictMode>,
);

// Fade out the HTML splash screen now that React has mounted
const splash = document.getElementById("splash");
if (splash) {
  splash.style.opacity = "0";
  splash.style.visibility = "hidden";
  splash.addEventListener("transitionend", () => splash.remove(), { once: true });
  // Fallback: remove after 600ms in case transitionend doesn't fire (CSP edge cases)
  setTimeout(() => splash.remove(), 600);
}
