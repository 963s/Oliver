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
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
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

/* ── Update Checker (Production) ─────────────────────────────────────────
   App ist nicht Apple-signiert → electron-updater kann auf macOS nicht
   installieren (Gatekeeper). Stattdessen: GitHub-Release-Check + Hinweis
   mit Link zum manuellen Download. */

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

let lastNotifiedVersion = null;

async function checkForUpdate(silent = true) {
  try {
    const rel = await fetchLatestRelease();
    if (rel.draft || !rel.tag_name) return null;
    const latest = String(rel.tag_name).replace(/^v/, "");
    const current = app.getVersion();
    if (compareSemver(latest, current) <= 0) return null;
    if (lastNotifiedVersion === latest) return null;
    lastNotifiedVersion = latest;

    const releaseUrl = rel.html_url || `https://github.com/${UPDATE_REPO.owner}/${UPDATE_REPO.repo}/releases/latest`;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update-available", {
        version: latest,
        currentVersion: current,
        url: releaseUrl,
        notes: rel.body ?? "",
      });
    }
    console.log(`[updater] Neue Version verfügbar: ${latest} (aktuell: ${current})`);
    return { version: latest, url: releaseUrl };
  } catch (err) {
    if (!silent) console.error("[updater] Prüfung fehlgeschlagen:", err.message);
    return null;
  }
}

function setupAutoUpdater() {
  if (isDev) return;
  setTimeout(() => { void checkForUpdate(); }, 8_000);
  setInterval(() => { void checkForUpdate(); }, UPDATE_CHECK_INTERVAL_MS);
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
  return await checkForUpdate(false);
});

// Frontend öffnet die Release-Seite im Browser für manuellen Download
ipcMain.handle("or:openUpdatePage", (_e, url) => {
  if (typeof url === "string" && url.startsWith("https://github.com/")) {
    void shell.openExternal(url);
  }
});
