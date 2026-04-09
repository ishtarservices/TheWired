import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { store } from "./store";
import App from "./app/App";
import "./index.css";

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
