/**
 * scripts/prepare-pack.mjs
 *
 * الحل الصحيح لمشكلة npm-workspaces + native modules:
 * 1. نبني backend-bundle/ بـ dist + drizzle + package.json
 * 2. نثبّت production deps مباشرة داخل backend-bundle (بدون workspaces)
 * 3. ثم electron-builder يعيد بناء .node per arch تلقائياً عبر install-app-deps
 *
 * الفرق عن السابق: نستخدم --prefix لتثبيت الـ deps مباشرة في backend-bundle
 * دون الرجوع لـ workspace root.
 */

import { execSync }   from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT   = path.join(__dirname, "..");
const SRC    = path.join(ROOT, "backend");
const BUNDLE = path.join(ROOT, "backend-bundle");

console.log("📦 prepare-pack …");

rmSync(BUNDLE, { recursive: true, force: true });
mkdirSync(BUNDLE, { recursive: true });

console.log("  → dist/");
cpSync(path.join(SRC, "dist"), path.join(BUNDLE, "dist"), { recursive: true });

console.log("  → drizzle/");
cpSync(path.join(SRC, "drizzle"), path.join(BUNDLE, "drizzle"), { recursive: true });

// package.json ohne devDependencies und ohne workspaces
const pkg = JSON.parse(readFileSync(path.join(SRC, "package.json"), "utf8"));
writeFileSync(path.join(BUNDLE, "package.json"), JSON.stringify({
  name:         pkg.name,
  version:      pkg.version,
  type:         pkg.type,
  dependencies: pkg.dependencies,
}, null, 2), "utf8");

console.log("  → npm install --prefix (isoliert, kein Workspace) …");
// --ignore-scripts: verhindert Rebuild hier — electron-builder macht das per Arch
execSync(
  "npm install --omit=dev --ignore-scripts --no-workspaces --prefer-offline",
  { cwd: BUNDLE, stdio: "inherit" }
);

console.log("✅ Backend-Bundle bereit:", BUNDLE);
