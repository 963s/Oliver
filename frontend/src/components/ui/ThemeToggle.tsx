import { useTheme } from "../../hooks/useTheme";

/** Sun / moon toggle button — drops into any flex row. */
export function ThemeToggle() {
  const { isDark, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      id="theme-toggle-btn"
      onClick={toggleTheme}
      aria-label={isDark ? "Zum hellen Modus wechseln" : "Zum dunklen Modus wechseln"}
      title={isDark ? "Light mode" : "Dark mode"}
      className="inline-flex h-7 w-7 items-center justify-center border border-deep-charcoal/[0.08] text-deep-charcoal/50 transition hover:border-deep-charcoal/20 hover:bg-gray-100/60 hover:text-editorial-pulse"
    >
      {isDark ? (
        /* Sun */
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-3.5 w-3.5">
          <circle cx="10" cy="10" r="3.5" />
          <line x1="10" y1="1.5"  x2="10" y2="3.5"  strokeLinecap="round" />
          <line x1="10" y1="16.5" x2="10" y2="18.5" strokeLinecap="round" />
          <line x1="1.5"  y1="10" x2="3.5"  y2="10" strokeLinecap="round" />
          <line x1="16.5" y1="10" x2="18.5" y2="10" strokeLinecap="round" />
          <line x1="4.3"  y1="4.3"  x2="5.7"  y2="5.7"  strokeLinecap="round" />
          <line x1="14.3" y1="14.3" x2="15.7" y2="15.7" strokeLinecap="round" />
          <line x1="14.3" y1="5.7"  x2="15.7" y2="4.3"  strokeLinecap="round" />
          <line x1="4.3"  y1="15.7" x2="5.7"  y2="14.3" strokeLinecap="round" />
        </svg>
      ) : (
        /* Moon */
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
          <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
        </svg>
      )}
    </button>
  );
}
