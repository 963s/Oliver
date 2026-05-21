/**
 * electron/main.mjs
 * Oliver Roos POS — Electron Main Process
 *
 * Production: Backend (dist/index.js) + Frontend (static aus API serviert)
 * Dev:        Backend (tsx) + Frontend (Vite dev-server)
 */

import { app, BrowserWindow, Menu, ipcMain, shell, dialog, Tray, nativeImage } from "electron";
import electronUpdaterPkg from "electron-updater";
const { autoUpdater } = electronUpdaterPkg;
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import crypto from "node:crypto";

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

  // Beim ersten Start: vorhandene DB aus dem Bundle kopieren (Migration)
  if (!existsSync(targetDb)) {
    const backendDir = app.isPackaged ? path.join(process.resourcesPath, "backend") : path.join(projectRoot, "backend");
    const bundleDb = path.join(backendDir, "data", "salon.db");
    if (existsSync(bundleDb)) {
      copyFileSync(bundleDb, targetDb);
      console.log("[electron] DB migriert nach userData:", targetDb);
    }
  }
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

/* ── Auto-Updater (Production) ───────────────────────────────────────────── */

function setupAutoUpdater() {
  if (isDev) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info) => {
    console.log("[updater] Update verfügbar:", info.version);
    // Stilles Herunterladen — kein Dialog, kein Unterbrechen
  });

  autoUpdater.on("update-downloaded", (info) => {
    console.log("[updater] Update heruntergeladen:", info.version);
    dialog.showMessageBox({
      type: "info",
      title: "Update verfügbar",
      message: `Ein neues Update (Version ${info.version}) wurde heruntergeladen!`,
      detail: "Bitte starte die Anwendung neu, um das Update zu installieren.",
      buttons: ["Später", "Jetzt neu starten"],
      defaultId: 1
    }).then((res) => {
      if (res.response === 1) {
        autoUpdater.quitAndInstall();
      }
    });
    if (mainWindow) {
      mainWindow.webContents.send("update-downloaded", { version: info.version });
    }
  });

  autoUpdater.on("error", (err) => {
    console.error("[updater] Fehler:", err.message);
    // Fehler still ignorieren — App funktioniert trotzdem
  });

  // Beim Start prüfen, dann alle 4 Stunden
  void autoUpdater.checkForUpdates().catch(() => {});
  setInterval(() => { void autoUpdater.checkForUpdates().catch(() => {}); }, 4 * 60 * 60 * 1000);
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

// Vom Frontend ausgelöster Neustart nach Update
ipcMain.handle("or:installUpdate", () => {
  autoUpdater.quitAndInstall(false, true);
});
