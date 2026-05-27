import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Light mode only — dark theme was removed in v1.7.0 (salon owner only uses one mode).
// Clean any stale 'dark' class or localStorage flag from older app versions.
try {
  document.documentElement.classList.remove("dark");
  localStorage.removeItem("or:theme");
} catch {}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
