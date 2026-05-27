/** @type {import('tailwindcss').Config} */
/**
 * Semantic color tokens point to CSS custom properties in :root (light only).
 * Dark mode was removed in v1.7.0 — the salon UI is single-theme by design.
 */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: false,
  theme: {
    extend: {
      colors: {
        /** ── Semantic tokens mapped to CSS vars ── */
        "void-onyx":      "var(--app-void)",
        "matte-black":    "var(--app-surface-2)",
        "deep-charcoal":  "var(--app-text)",
        "canvas-white":   "var(--app-bg)",
        "brushed-chrome": "var(--app-chrome)",

        /** ── Fixed accent (same in both modes) ── */
        "champagne-gold": "#D4AF37",
        "oak-wood":       "#A0522D",

        /** ── Route pulse accents ── */
        "pulse-saffron":  "#E8B923",
        "pulse-crimson":  "#DB2828",
        "pulse-violet":   "#7C3AED",

        /** ── Legacy aliases ── */
        onyx:   "var(--app-surface-2)",
        canvas: "var(--app-bg)",
        oak:    "#A0522D",
        chrome: "var(--app-chrome)",
      },
      boxShadow: {
        luxury:
          "0 24px 48px -12px rgba(0,0,0,0.45), 0 0 0 1px rgba(212,175,55,0.06), 0 12px 40px -8px rgba(212,175,55,0.05)",
        "luxury-glow":
          "0 0 0 1px rgba(212,175,55,0.08), 0 20px 50px -15px rgba(212,175,55,0.12), 0 32px 64px -20px rgba(0,0,0,0.5)",
      },
      fontFamily: {
        sans:               ['"Raleway"', '"Open Sans"', "ui-sans-serif", "system-ui", "sans-serif"],
        "editorial-body":   ['"Raleway"', "ui-sans-serif", "system-ui", "sans-serif"],
        "editorial-display":['"Bebas Neue"', '"Montserrat"', "ui-sans-serif", "sans-serif"],
        heading:            ['"Bebas Neue"', '"Montserrat"', "ui-sans-serif", "system-ui", "sans-serif"],
      },
      borderRadius: {
        none: "0", sm: "0", DEFAULT: "0", md: "0", lg: "0",
        xl: "0", "2xl": "0", "3xl": "0", "4xl": "0",
        bento:       "0.5rem",
        luxury:      "1.5rem",
        "luxury-md": "1rem",
      },
      minHeight: { touch: "48px" },
      minWidth:  { touch: "48px" },
    },
  },
  plugins: [],
};
