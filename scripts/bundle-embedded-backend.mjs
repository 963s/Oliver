#!/usr/bin/env node
/**
 * Prepares `src-tauri/embedded-backend/` for macOS desktop bundles:
 * - Downloads a pinned Node.js binary (for ABI match with rebuilt better-sqlite3).
 * - Copies backend dist, drizzle migrations, package.json, and production node_modules.
 * - Rebuilds `better-sqlite3` against the bundled Node.
 *
 * Run from repo root after `npm run build -w @oliver-roos/backend`.
 * Non-macOS: exits 0 with a stub README (Rust skips auto-start; use dev:backend).
 */

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const outDir = join(root, "src-tauri", "embedded-backend");
const backendRoot = join(root, "backend");
const distEntry = join(backendRoot, "dist", "index.js");

const NODE_VERSION = "22.14.0";

function nodeArchiveName() {
  const p = process.platform;
  const a = process.arch === "arm64" ? "arm64" : "x64";
  if (p !== "darwin") return null;
  return `node-v${NODE_VERSION}-darwin-${a}`;
}

async function downloadToFile(url, dest) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Download failed ${url}: ${res.status}`);
  }
  const ab = await res.arrayBuffer();
  writeFileSync(dest, Buffer.from(ab));
}

async function main() {
  const name = nodeArchiveName();
  if (!name) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, "README.txt"),
      "Embedded backend auto-bundle is only run on macOS (darwin).\n" +
        "On this OS the Tauri shell will not auto-start the API — run `npm run dev:backend` separately.\n",
    );
    console.warn(
      "[bundle-embedded-backend] Non-macOS host: wrote stub; Tauri will skip embedded API.",
    );
    return;
  }

  if (!existsSync(distEntry)) {
    console.error(
      "[bundle-embedded-backend] Missing backend build:",
      distEntry,
      "\nRun: npm run build -w @oliver-roos/backend",
    );
    process.exit(1);
  }

  mkdirSync(outDir, { recursive: true });
  for (const name of ["node", "dist", "node_modules", "drizzle", "package.json"]) {
    rmSync(join(outDir, name), { recursive: true, force: true });
  }

  const url = `https://nodejs.org/dist/v${NODE_VERSION}/${name}.tar.gz`;
  const tmp = mkdtempSync(join(tmpdir(), "or-node-"));
  const tgz = join(tmp, "node.tar.gz");

  console.log("[bundle-embedded-backend] Downloading", url);
  try {
    await downloadToFile(url, tgz);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }

  const r = spawnSync("tar", ["-xzf", tgz, "-C", tmp], { stdio: "inherit" });
  if (r.status !== 0) {
    console.error("[bundle-embedded-backend] tar extract failed");
    process.exit(1);
  }

  const extracted = join(tmp, name);
  const nodeBin = join(extracted, "bin", "node");
  if (!existsSync(nodeBin)) {
    console.error("[bundle-embedded-backend] Missing node binary at", nodeBin);
    process.exit(1);
  }

  cpSync(nodeBin, join(outDir, "node"));
  spawnSync("chmod", ["+x", join(outDir, "node")], { stdio: "inherit" });

  cpSync(join(backendRoot, "dist"), join(outDir, "dist"), { recursive: true });
  cpSync(join(backendRoot, "drizzle"), join(outDir, "drizzle"), { recursive: true });
  const pkg = JSON.parse(readFileSync(join(backendRoot, "package.json"), "utf8"));
  const slim = {
    name: pkg.name,
    version: pkg.version,
    type: pkg.type ?? "module",
    private: true,
    dependencies: pkg.dependencies,
  };
  writeFileSync(join(outDir, "package.json"), JSON.stringify(slim, null, 2));

  const pathEnv = `${join(extracted, "bin")}:${process.env.PATH ?? ""}`;
  const npmCli = join(extracted, "lib", "node_modules", "npm", "bin", "npm-cli.js");

  console.log("[bundle-embedded-backend] npm install --omit=dev (embedded tree) …");
  const inst = spawnSync(join(extracted, "bin", "node"), [npmCli, "install", "--omit=dev", "--no-audit", "--no-fund"], {
    cwd: outDir,
    env: { ...process.env, PATH: pathEnv },
    stdio: "inherit",
  });
  if (inst.status !== 0) {
    console.error("[bundle-embedded-backend] npm install in embedded-backend failed");
    process.exit(1);
  }

  console.log("[bundle-embedded-backend] Rebuilding better-sqlite3 for bundled Node …");
  const rb = spawnSync(join(extracted, "bin", "node"), [npmCli, "rebuild", "better-sqlite3", "--foreground-scripts"], {
    cwd: outDir,
    env: { ...process.env, PATH: pathEnv },
    stdio: "inherit",
  });
  if (rb.status !== 0) {
    console.error("[bundle-embedded-backend] npm rebuild better-sqlite3 failed");
    process.exit(1);
  }

  rmSync(tmp, { recursive: true, force: true });

  writeFileSync(
    join(outDir, "README.txt"),
    "Bundled Oliver Roos POS API runtime (Node + dist + drizzle + node_modules).\n" +
      `Node ${NODE_VERSION} (${name}).\n`,
  );

  console.log("[bundle-embedded-backend] Done →", outDir);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
