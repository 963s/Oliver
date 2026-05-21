import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Apply saved theme before first paint — default is light
try {
  const stored = localStorage.getItem("or:theme");
  if (stored === "dark") {
    document.documentElement.classList.add("dark");
  }
  // Light theme is default — no class needed
} catch {}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
