/** One dominant accent per view — never mix vibrants */

export type EditorialPulse = "saffron" | "crimson" | "violet";

/** Map route to pulse accent (SPA path after basename). */
export function editorialPulseForPath(pathname: string): EditorialPulse {
  const p = pathname.split("?")[0] ?? "/";
  if (p.includes("/mirror") || p.includes("/walk-in")) return "crimson";
  if (p.startsWith("/admin") || p.includes("/daily-closing") || p.includes("/inventur")) return "violet";
  if (p.includes("/estimate") || p.includes("/rings")) return "violet";
  return "saffron";
}

export function editorialPulseRgb(pulse: EditorialPulse): string {
  switch (pulse) {
    case "crimson":
      return "rgb(219, 40, 40)";
    case "violet":
      return "rgb(124, 58, 237)";
    default:
      return "rgb(232, 185, 35)";
  }
}
