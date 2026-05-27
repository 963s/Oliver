/**
 * scripts/after-pack.mjs
 *
 * Nach dem Paketieren: installiert native deps im App-Bundle
 * für die korrekte Architektur (arm64 oder x64) via @electron/rebuild API.
 */

import { rebuild } from "@electron/rebuild";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

/**
 * @param {import('electron-builder').AfterPackContext} context
 */
export default async function afterPack(context) {
  const { appOutDir, arch, packager } = context;

  // Arch-Nummern: 0=ia32, 1=x64, 3=arm64
  const archNames = { 0: "ia32", 1: "x64", 3: "arm64", 4: "arm64" };
  const archName  = archNames[arch] ?? "x64";

  // Pfad zum backend-Ordner im App-Bundle
  let backendDir;
  if (process.platform === "darwin") {
    backendDir = path.join(
      appOutDir,
      `${packager.appInfo.productFilename}.app`,
      "Contents", "Resources", "backend"
    );
  } else {
    backendDir = path.join(appOutDir, "resources", "backend");
  }

  if (!existsSync(backendDir)) {
    console.warn("[after-pack] backend nicht gefunden:", backendDir);
    return;
  }

  // Zuerst deps installieren (ohne native rebuild — nur JS-Deps)
  const nodeModules = path.join(backendDir, "node_modules");
  if (!existsSync(nodeModules)) {
    console.log(`[after-pack] npm install in ${backendDir} …`);
    execSync("npm install --omit=dev --ignore-scripts", {
      cwd:   backendDir,
      stdio: "inherit",
    });
  }

  const electronVersion = packager.electronVersion ?? "32.3.3";

  console.log(`[after-pack] Rebuild better-sqlite3 für ${archName} (Electron ${electronVersion}) …`);

  await rebuild({
    buildPath:       backendDir,
    electronVersion: electronVersion,
    arch:            archName,
    onlyModules:     ["better-sqlite3"],
    forceRebuild:    true,
  });

  console.log(`[after-pack] ✅ better-sqlite3 ${archName} fertig.`);

  /**
   * Macs (Sequoia / Sonoma) reject any app whose ad-hoc signature does not
   * match the bundle contents. electron-builder signs the bundle ad-hoc
   * before we get here, then this hook installs `node_modules` and rebuilds
   * `better-sqlite3` — those writes invalidate the signature, so macOS
   * shows "The app has been modified or damaged" on first launch.
   *
   * We are not Apple-signed, so the cleanest fix is to **re-apply the
   * ad-hoc signature** after all modifications. The `-` identity is
   * codesign's ad-hoc marker; `--deep` re-signs nested frameworks too
   * (Electron Framework, Squirrel helpers).
   */
  if (process.platform === "darwin") {
    const appBundle = path.join(
      appOutDir,
      `${packager.appInfo.productFilename}.app`,
    );
    console.log(`[after-pack] Re-signing app bundle (ad-hoc) → ${appBundle}`);
    try {
      execSync(
        `codesign --force --deep --sign - "${appBundle}"`,
        { stdio: "inherit" },
      );
      console.log(`[after-pack] ✅ ad-hoc re-sign fertig.`);
    } catch (err) {
      console.error(`[after-pack] ⚠ codesign failed: ${err?.message ?? err}`);
      console.error(`[after-pack] App will still ship but may trigger "modified" warnings on macOS 15+.`);
    }
  }
}
