// Polyfill: crypto.randomUUID is not available in non-secure contexts (HTTP)
if (typeof crypto !== "undefined" && !crypto.randomUUID) {
  crypto.randomUUID = () =>
    "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
      (+c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))).toString(16),
    ) as `${string}-${string}-${string}-${string}-${string}`;
}

import React from "react";
import ReactDOM from "react-dom/client";
import "./shared/i18n/config";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
