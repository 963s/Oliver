/**
 * electron/main.mjs
 * Oliver Roos POS — Electron Main Process
 *
 * Production: Backend (dist/index.js) + Frontend (static aus API serviert)
 * Dev:        Backend (tsx) + Frontend (Vite dev-server)
 */

import { app, BrowserWindow, Menu, ipcMain, shell, dialog, Tray, nativeImage } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";

const UPDATE_REPO = { owner: "963s", repo: "Oliver" };
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ── Pfade ────────────────────────────────────────────────────────────────── */

function getProjectRoot() {
  if (!app.isPackaged) return path.join(__dirname, "..");
  const p = app.getAppPath();
  if (p.includes("app.asar")) return p.replace("app.asar", "app.asar.unpacked");
  return p;
}

const isDev = !app.isPackaged || process.env.ELECTRON_DEV === "1";
const projectRoot = getProjectRoot();

/**
 * Datenbank: in userData (überlebt App-Updates!)
 * ~/Library/Application Support/oliver-roos-pos/salon.db
 */
function getDbPath() {
  if (process.env.SALON_DB_PATH) return path.resolve(process.env.SALON_DB_PATH);

  const userDataDir = app.getPath("userData");
  mkdirSync(userDataDir, { recursive: true });
  const targetDb = path.join(userDataDir, "salon.db");
  // Keine vorab gebundelte DB mehr — Drizzle migrate() erzeugt
  // beim ersten Start ein leeres Schema aus allen Migrations.
  return targetDb;
}

const API_PORT = process.env.PORT ?? "3000";
const VITE_PORT = "5173";

// tsx: erst lokal im backend suchen, dann im Root (npm-Workspaces-Hoisting)
const tsxLocal   = path.join(projectRoot, "backend", "node_modules", "tsx", "dist", "cli.mjs");
const tsxHoisted = path.join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs");
const tsxCli     = existsSync(tsxLocal) ? tsxLocal : tsxHoisted;

/* ── Prozess-Handles ─────────────────────────────────────────────────────── */

/** @type {import('node:child_process').ChildProcess | null} */
let backendChild = null;
/** @type {import('node:child_process').ChildProcess | null} */
let viteChild = null;
/** @type {BrowserWindow | null} */
let mainWindow = null;

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function waitForHttpOk(url, timeoutMs = 45_000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) resolve();
        else if (Date.now() - start > timeoutMs) reject(new Error(`Timeout: ${url}`));
        else setTimeout(tryOnce, 300);
      });
      req.on("error", () => {
        if (Date.now() - start > timeoutMs) reject(new Error(`Timeout: ${url}`));
        else setTimeout(tryOnce, 300);
      });
    };
    tryOnce();
  });
}

function killChild(child, label) {
  if (!child?.pid) return;
  try { child.kill("SIGTERM"); } catch { /* ignore */ }
  if (label) console.log(`[electron] Gestoppt: ${label}`);
}

/* ── Backend starten ─────────────────────────────────────────────────────── */

function startBackend() {
  const backendCwd = app.isPackaged ? path.join(process.resourcesPath, "backend") : path.join(projectRoot, "backend");
  const DB_PATH    = getDbPath();

  const frontendPath = app.isPackaged
    ? path.join(process.resourcesPath, "app", "frontend", "dist")
    : path.join(projectRoot, "frontend", "dist");

  function getAuthSecret() {
    const userDataDir = app.getPath("userData");
    const secretPath = path.join(userDataDir, ".auth_secret");
    if (existsSync(secretPath)) {
      return readFileSync(secretPath, "utf8").trim();
    }
    const newSecret = crypto.randomBytes(32).toString("hex");
    writeFileSync(secretPath, newSecret, "utf8");
    return newSecret;
  }

  const authSecret = getAuthSecret();

  const env = {
    ...process.env,
    PORT:          String(API_PORT),
    DATABASE_PATH: DB_PATH,
    FRONTEND_PATH: frontendPath,
    AUTH_SECRET:   authSecret,
    NODE_ENV:      isDev ? "development" : "production",
    ...(isDev ? {} : { SERVE_SPA: "1" }),
  };

  console.log("[electron] DATABASE_PATH:", env.DATABASE_PATH);
  console.log("[electron] isDev:", isDev);

  if (isDev) {
    if (!existsSync(tsxCli)) {
      dialog.showErrorBox(
        "Konfigurationsfehler",
        "tsx nicht gefunden. Bitte 'npm install' im Projektordner ausführen.",
      );
      app.quit();
      return null;
    }
    console.log("[electron] tsx:", tsxCli);
    return spawn(
      process.platform === "win32" ? "node.exe" : "node",
      [tsxCli, "src/index.ts"],
      { cwd: backendCwd, env, stdio: "inherit" },
    );
  }

  // Production: compiled JS
  const entry = path.join(backendCwd, "dist", "index.js");
  if (!existsSync(entry)) {
    dialog.showErrorBox(
      "Interner Fehler",
      `Backend nicht gefunden: ${entry}\n\nBitte neu installieren.`,
    );
    app.quit();
    return null;
  }

  return spawn(
    process.execPath,
    [entry],
    {
      cwd:   backendCwd,
      env:   { ...env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: "inherit",
    },
  );
}

/* ── Vite starten (nur Dev) ──────────────────────────────────────────────── */

function startVite() {
  const cwd    = path.join(projectRoot, "frontend");
  const viteBin = path.join(projectRoot, "node_modules", "vite", "bin", "vite.js");
  const args   = ["--host", "127.0.0.1", "--port", VITE_PORT, "--strictPort"];

  if (existsSync(viteBin)) {
    return spawn(process.platform === "win32" ? "node.exe" : "node", [viteBin, ...args], {
      cwd,
      stdio: "inherit",
    });
  }
  return spawn(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["vite", ...args],
    { cwd, stdio: "inherit", shell: true },
  );
}

/* ── Hauptfenster ────────────────────────────────────────────────────────── */

async function createWindow() {
  const winUrl = isDev
    ? `http://127.0.0.1:${VITE_PORT}/`
    : `http://127.0.0.1:${API_PORT}/`;

  mainWindow = new BrowserWindow({
    width:      1280,
    height:     860,
    minWidth:   900,
    minHeight:  600,
    title:      "Oliver Roos Friseur",
    // Kein natives Menü: eigene UI hat Navigations-Steuerung
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation:  true,
      nodeIntegration:   false,
      devTools:          isDev, // DevTools NUR im Dev-Modus
      preload:           path.join(__dirname, "preload.mjs"),
    },
  });

  // Externes Links immer im Browser öffnen, nicht in Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  // Kontextmenü-Shortcuts (Copy/Paste) deaktivieren im Production
  if (!isDev) {
    mainWindow.webContents.on("context-menu", (e) => e.preventDefault());
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.maximize();

  await mainWindow.loadURL(winUrl);

  // DevTools nur im Dev-Modus
  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }
}

/* ── Menü entfernen (Production) ─────────────────────────────────────────── */

function setupMenu() {
  if (isDev) return; // Im Dev: Standard-Menü behalten (Debug-Funktionen)
  Menu.setApplicationMenu(null);
}

/* ── Update Checker + Installer (Production) ────────────────────────────
   App ist nicht Apple-signiert. Strategie:
   1. checkForUpdate: pollt GitHub-API, findet passende DMG (Intel/ARM)
   2. UpdateBanner zeigt "Jetzt installieren"
   3. or:installUpdate IPC: lädt DMG, schreibt Helper-Skript, beendet App;
      Helper hängt DMG an, ersetzt /Applications-App, entfernt Quarantine,
      startet die App neu — wie ein open-source-Tool. */

function compareSemver(a, b) {
  const pa = a.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return 1;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return -1;
  }
  return 0;
}

function fetchLatestRelease() {
  return new Promise((resolve, reject) => {
    const req = https.get({
      hostname: "api.github.com",
      path: `/repos/${UPDATE_REPO.owner}/${UPDATE_REPO.repo}/releases/latest`,
      headers: {
        "User-Agent": "OliverRoosPOS-Updater",
        "Accept": "application/vnd.github+json",
      },
      timeout: 10_000,
    }, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => {
        if (res.statusCode === 200) {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(e); }
        } else {
          reject(new Error(`GitHub API ${res.statusCode}`));
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(new Error("Timeout")); });
  });
}

/** Returns the DMG asset URL for the current architecture, or null if not found. */
function pickDmgForArch(rel) {
  const isArm = process.arch === "arm64";
  const assets = rel.assets ?? [];
  // Intel match: ends with version.dmg (no arch suffix). Arm: contains arm64.dmg
  for (const a of assets) {
    const name = a.name || "";
    if (!name.endsWith(".dmg")) continue;
    if (name.includes("blockmap")) continue;
    const hasArm = name.includes("arm64");
    if (isArm && hasArm) return a.browser_download_url;
    if (!isArm && !hasArm) return a.browser_download_url;
  }
  return null;
}

let lastNotifiedVersion = null;
let pendingUpdate = null;        // { version, dmgUrl, releaseUrl } — null if no update available
let lastCheckedAt = null;        // ms timestamp of last successful check
let lastCheckError = null;       // last error message from a failed check
let lastCheckOutcome = "never";  // "never" | "no_update" | "update_available" | "error"

function broadcastBanner(latest, current, dmgUrl, releaseUrl, notes) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("update-available", {
      version: latest,
      currentVersion: current,
      url: releaseUrl,
      dmgUrl,
      canAutoInstall: dmgUrl != null && process.platform === "darwin",
      platform: process.platform,
      notes: notes ?? "",
    });
  }
}

/**
 * Checks GitHub for a new release.
 *  - Always logs the outcome (so it shows up in Console.app).
 *  - When called with manual=true, also broadcasts a "no update" status so the
 *    UI can confirm the check ran.
 */
async function checkForUpdate({ manual = false } = {}) {
  console.log(`[updater] checkForUpdate(manual=${manual}) — current=${app.getVersion()}`);
  try {
    const rel = await fetchLatestRelease();
    lastCheckedAt = Date.now();
    lastCheckError = null;

    if (rel.draft || !rel.tag_name) {
      lastCheckOutcome = "no_update";
      console.log("[updater] release is draft or untagged — nothing to do");
      return { status: "no_update", current: app.getVersion() };
    }
    const latest  = String(rel.tag_name).replace(/^v/, "");
    const current = app.getVersion();
    const cmp = compareSemver(latest, current);
    if (cmp <= 0) {
      lastCheckOutcome = "no_update";
      pendingUpdate = null;
      console.log(`[updater] up-to-date (latest=${latest}, current=${current})`);
      // Echo back to renderer so a manual "Jetzt prüfen" gets confirmation.
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("update-check-complete", {
          status: "no_update",
          current,
          latest,
          checkedAt: lastCheckedAt,
        });
      }
      return { status: "no_update", current, latest };
    }

    const dmgUrl = pickDmgForArch(rel);
    const releaseUrl = rel.html_url || `https://github.com/${UPDATE_REPO.owner}/${UPDATE_REPO.repo}/releases/latest`;
    pendingUpdate = { version: latest, dmgUrl, releaseUrl, notes: rel.body ?? "" };
    lastCheckOutcome = "update_available";
    console.log(`[updater] NEW VERSION ${latest} (current ${current})  DMG: ${dmgUrl ?? "—"}`);

    // Re-broadcast even if already notified this version: the renderer may have
    // mounted late, or the user dismissed and we want it re-shown after restart.
    const isNewToThisSession = lastNotifiedVersion !== latest;
    lastNotifiedVersion = latest;
    if (isNewToThisSession || manual) {
      broadcastBanner(latest, current, dmgUrl, releaseUrl, rel.body);
    }
    return { status: "update_available", current, latest, dmgUrl };
  } catch (err) {
    lastCheckError = err instanceof Error ? err.message : String(err);
    lastCheckOutcome = "error";
    console.error("[updater] check failed:", lastCheckError);
    if (manual && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update-check-complete", {
        status: "error",
        error: lastCheckError,
        checkedAt: Date.now(),
      });
    }
    return { status: "error", error: lastCheckError };
  }
}

/** Called as soon as the renderer mounts, so the banner can re-display
 *  if there was already a pending update (avoids the IPC-before-listener race). */
function getPendingUpdate() {
  return pendingUpdate
    ? { ...pendingUpdate, currentVersion: app.getVersion() }
    : null;
}

function setupAutoUpdater() {
  if (isDev) return;
  // First check fires fast (3s — backend is usually ready by then).
  setTimeout(() => { void checkForUpdate(); }, 3_000);
  // Then every 30 minutes (was 4h — too long if the user works in short
  // sessions and never sees the banner).
  setInterval(() => { void checkForUpdate(); }, 30 * 60 * 1000);

  // Re-check when the OS network comes back online.
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.executeJavaScript(
      "window.addEventListener('online', () => window.orElectron?.checkForUpdate?.());"
    ).catch(() => {});
  }
}

/* ── Update Installer ───────────────────────────────────────────────────
   Lädt DMG, schreibt Helper-Skript, startet es detached, beendet App.
   Das Skript wartet auf den App-Exit, mountet DMG, ersetzt App-Bundle,
   entfernt Quarantine, startet App neu.  */

function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(destPath);
    const followRedirects = (u, depth = 0) => {
      if (depth > 5) return reject(new Error("Too many redirects"));
      https.get(u, {
        headers: { "User-Agent": "OliverRoosPOS-Updater" },
      }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return followRedirects(res.headers.location, depth + 1);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const total = parseInt(res.headers["content-length"] || "0", 10);
        let received = 0;
        res.on("data", (chunk) => {
          received += chunk.length;
          if (onProgress && total > 0) onProgress(received, total);
        });
        res.pipe(file);
        file.on("finish", () => file.close(() => resolve(destPath)));
      }).on("error", reject);
    };
    followRedirects(url);
  });
}

async function performInstallUpdate() {
  if (!pendingUpdate || !pendingUpdate.dmgUrl) {
    throw new Error("Kein Update verfügbar");
  }
  const { version, dmgUrl } = pendingUpdate;
  const userData = app.getPath("userData");
  const updatesDir = path.join(userData, "updates");
  mkdirSync(updatesDir, { recursive: true });
  const dmgPath = path.join(updatesDir, `oliver-${version}.dmg`);

  // Progress-Reports an Renderer
  const reportProgress = (received, total) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update-progress", {
        received, total, percent: Math.round((received / total) * 100),
      });
    }
  };

  console.log(`[updater] Lade DMG: ${dmgUrl}`);
  await downloadFile(dmgUrl, dmgPath, reportProgress);
  console.log(`[updater] DMG gespeichert: ${dmgPath}`);

  // Helper-Skript schreiben (in /tmp; selbst-löschend)
  const appName = "Oliver Roos Friseur";
  const appPath = `/Applications/${appName}.app`;
  const scriptPath = path.join(tmpdir(), `oliver-update-${Date.now()}.sh`);
  const helper = `#!/bin/bash
set -e
LOG="${userData}/updates/install-$(date +%Y%m%d-%H%M%S).log"
exec > "$LOG" 2>&1
echo "Update-Installer gestartet $(date)"
# Warte bis die App komplett beendet ist (max 30 s)
for i in $(seq 1 30); do
  if ! pgrep -f "${appName}" >/dev/null; then break; fi
  sleep 1
done
sleep 2  # Sicherheitspuffer
echo "App beendet, montiere DMG ..."
MOUNT_OUT=$(hdiutil attach "${dmgPath}" -nobrowse -quiet)
MOUNT=$(echo "$MOUNT_OUT" | grep '/Volumes/' | awk -F '\\t' '{print $NF}' | head -n1)
if [ -z "$MOUNT" ]; then echo "Mount fehlgeschlagen"; exit 1; fi
echo "Gemountet: $MOUNT"
if [ -d "${appPath}" ]; then
  rm -rf "${appPath}"
fi
cp -R "$MOUNT/${appName}.app" "${appPath}"
hdiutil detach "$MOUNT" -quiet
xattr -dr com.apple.quarantine "${appPath}" 2>/dev/null || true
echo "Installation abgeschlossen, starte App neu ..."
sleep 1
open "${appPath}"
rm -f "$0"
rm -f "${dmgPath}"
`;
  writeFileSync(scriptPath, helper, { mode: 0o755 });
  console.log(`[updater] Helper geschrieben: ${scriptPath}`);

  // Detached + unref → läuft weiter, nachdem die App beendet ist
  spawn("/bin/bash", [scriptPath], {
    detached: true,
    stdio: "ignore",
  }).unref();

  // App beenden (Helper übernimmt)
  setTimeout(() => { app.quit(); }, 500);
  return { ok: true, version };
}

/* ── App lifecycle ───────────────────────────────────────────────────────── */

// Single-Instance: zweite Instanz bringt Hauptfenster in den Vordergrund
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(async () => {
  setupMenu();

  backendChild = startBackend();
  if (!backendChild) return; // Fehler → App beendet sich

  // Warten bis Backend erreichbar
  await waitForHttpOk(`http://127.0.0.1:${API_PORT}/api/health`, 45_000).catch((e) => {
    console.error("[electron] Backend nicht erreichbar:", e.message);
    dialog.showErrorBox("Startfehler", "Der interne Server konnte nicht gestartet werden.\nBitte App neu starten.");
    app.quit();
  });

  if (isDev) {
    viteChild = startVite();
    await waitForHttpOk(`http://127.0.0.1:${VITE_PORT}/`, 60_000).catch(console.error);
  }

  await createWindow();
  setupAutoUpdater();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

// macOS: App beendet sich wenn kein Fenster offen ist
app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", () => {
  killChild(viteChild,   "vite");
  killChild(backendChild, "backend");
});

/* ── IPC ─────────────────────────────────────────────────────────────────── */

ipcMain.handle("or:getPaths", () => ({
  projectRoot: getProjectRoot(),
  databasePath: getDbPath(),
  isDev,
  version: app.getVersion(),
}));

// Frontend kann manuellen Update-Check anstoßen
ipcMain.handle("or:checkForUpdate", async () => {
  return await checkForUpdate({ manual: true });
});

// Frontend fragt beim Mounten nach hängenden Updates (löst die "IPC vor Listener"-Race)
ipcMain.handle("or:getPendingUpdate", () => {
  return getPendingUpdate();
});

// Status für die Einstellungs-Seite (Version + letzter Check)
ipcMain.handle("or:getUpdateStatus", () => {
  return {
    currentVersion: app.getVersion(),
    pendingUpdate,
    lastCheckedAt,
    lastCheckOutcome,
    lastCheckError,
  };
});

// Frontend öffnet die Release-Seite im Browser für manuellen Download
ipcMain.handle("or:openUpdatePage", (_e, url) => {
  if (typeof url === "string" && url.startsWith("https://github.com/")) {
    void shell.openExternal(url);
  }
});

// Frontend triggert vollautomatische Installation (nur macOS)
ipcMain.handle("or:installUpdate", async () => {
  try {
    return await performInstallUpdate();
  } catch (err) {
    console.error("[updater] Installation fehlgeschlagen:", err.message);
    return { ok: false, error: err.message };
  }
});
