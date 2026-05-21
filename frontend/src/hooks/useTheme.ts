import { create } from "zustand";
import { useEffect } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "or:theme";

function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
    if (stored === "dark" || stored === "light") return stored;
  } catch {}
  return "light"; // Salon default: always light unless user explicitly chose dark
}

function applyThemeClass(t: Theme) {
  document.documentElement.classList.toggle("dark", t === "dark");
  try { localStorage.setItem(STORAGE_KEY, t); } catch {}
}

type ThemeStore = {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
};

const useThemeStore = create<ThemeStore>((set) => ({
  theme: getInitialTheme(),
  toggleTheme: () =>
    set((s) => {
      const next: Theme = s.theme === "dark" ? "light" : "dark";
      applyThemeClass(next);
      return { theme: next };
    }),
  setTheme: (t: Theme) => {
    applyThemeClass(t);
    set({ theme: t });
  },
}));

/** Global theme hook — backed by Zustand so all callers share state. */
export function useTheme() {
  const { theme, toggleTheme, setTheme } = useThemeStore();

  // Ensure DOM class is in sync on first mount
  useEffect(() => {
    applyThemeClass(theme);
  }, [theme]);

  return { theme, toggleTheme, setTheme, isDark: theme === "dark" };
}
