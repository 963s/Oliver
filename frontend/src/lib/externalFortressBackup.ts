/**
 * Step 49 — External fortress backup: consistent SQLite snapshot to a user-chosen path (Tauri).
 * Uses the same admin-only HTTP backup as the Chef dashboard; reflects DB as at snapshot time
 * (including anonymized client rows — no PII resurrection from the file).
 */

import { formatInTimeZone } from "date-fns-tz";
import { apiGet, apiPatch, apiPost, headers } from "../api";
import { BERLIN } from "./formatTime";
import { isTauriShell } from "./deviceContext";

export type ExternalBackupSchedule = "manual" | "daily_after_close" | "twice_daily";

export type ExternalBackupSettings = {
  backupPath: string;
  schedule: ExternalBackupSchedule;
  lastOk: boolean | null;
  lastDetail: string;
  lastAtMs: number | null;
};

export type FortressTrigger =
  | "manual_ui"
  | "tagesabschluss"
  | "slot_morgen"
  | "slot_abend";

export async function fetchExternalBackupSettings(): Promise<ExternalBackupSettings> {
  return apiGet<ExternalBackupSettings>("/api/admin/settings/external-backup");
}

export async function patchExternalBackupSettings(body: {
  backupPath?: string | null;
  schedule?: ExternalBackupSchedule;
}): Promise<void> {
  await apiPatch("/api/admin/settings/external-backup", body);
}

export async function reportExternalFortressSyncResult(ok: boolean, detail: string): Promise<void> {
  await apiPost("/api/admin/settings/external-backup/sync-result", { ok, detail });
}

async function fetchSqliteBackupBlob(): Promise<{ blob: Blob; fname: string }> {
  const base = import.meta.env.VITE_API_BASE ?? "";
  const h = { ...headers() };
  delete (h as Record<string, string>)["Content-Type"];
  const url = `${base}/api/system/backup/sqlite`;
  const r = await fetch(url, { headers: h });
  if (!r.ok) {
    let msg = r.statusText;
    try {
      const j = (await r.json()) as { error?: string; reason?: string };
      msg = (j.reason ?? j.error ?? msg) || msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg || "sqlite_backup_failed");
  }
  const blob = await r.blob();
  const cd = r.headers.get("Content-Disposition");
  let fname = `salon_backup_${formatInTimeZone(new Date(), BERLIN, "yyyy_MM_dd")}.sqlite`;
  const m = cd?.match(/filename="([^"]+)"/);
  if (m?.[1]) fname = m[1];
  return { blob, fname };
}

/**
 * Copies the SQLite fortress bundle into `backupPath`/Fortress_YYYY_MM_DD_HHmmss/ (Berlin stamp).
 */
export async function runExternalFortressBackup(args: {
  backupPath?: string | null;
  trigger: FortressTrigger;
}): Promise<{ ok: boolean; detail: string }> {
  if (!isTauriShell()) {
    return { ok: false, detail: "needs_desktop_shell" };
  }

  let basePath =
    typeof args.backupPath === "string" ? args.backupPath.trim() : "";
  if (!basePath) {
    try {
      const s = await fetchExternalBackupSettings();
      basePath = (s.backupPath ?? "").trim();
    } catch {
      return { ok: false, detail: "settings_load_failed" };
    }
  }
  if (!basePath) {
    return { ok: false, detail: "no_backup_path" };
  }

  const stampFolder = formatInTimeZone(new Date(), BERLIN, "yyyy_MM_dd_HHmmss");
  try {
    const { join } = await import("@tauri-apps/api/path");
    const { mkdir, writeFile } = await import("@tauri-apps/plugin-fs");

    const { blob, fname } = await fetchSqliteBackupBlob();
    const bundleDir = await join(basePath, `Fortress_${stampFolder}`);
    await mkdir(bundleDir, { recursive: true });

    const destSqlite = await join(bundleDir, fname || "salon.sqlite");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await writeFile(destSqlite, bytes);

    const manifest = {
      version: 1,
      generator: "OliverRoos POS — Step 49 External Fortress",
      generatedAtBerlin: formatInTimeZone(new Date(), BERLIN, "yyyy-MM-dd'T'HH:mm:ssXXX"),
      trigger: args.trigger,
      sqliteFile: fname || "salon.sqlite",
      notes:
        "Vollständiger SQLite-Snapshot über backup(); enthält Bewegungsdaten, audit_logs und system_settings zum Zeitpunkt der Erstellung. Bereits anonymisierte Kundenstammdaten bleiben anonym — es erfolgt keine Wiederherstellung von PII.",
    };
    const manifestPath = await join(bundleDir, "BACKUP_MANIFEST.json");
    await writeFile(
      manifestPath,
      new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
    );

    /** Step 50 — cadenced VACUUM only when interval elapsed (never every single backup). */
    try {
      await apiPost("/api/admin/system/sqlite-maintain", { vacuumIfDue: true });
    } catch {
      /* non-blocking */
    }

    return { ok: true, detail: args.trigger };
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : "fortress_write_failed",
    };
  }
}

/**
 * Called when financial daily close succeeds (phase DONE).
 */
export async function runFortressBackupAfterClosingIfEligible(): Promise<void> {
  try {
    const s = await fetchExternalBackupSettings();
    if (s.schedule !== "daily_after_close") return;
    if (!(s.backupPath ?? "").trim()) return;
    const r = await runExternalFortressBackup({
      backupPath: s.backupPath,
      trigger: "tagesabschluss",
    });
    await reportExternalFortressSyncResult(r.ok, r.ok ? "tagesabschluss_ok" : r.detail);
  } catch {
    await reportExternalFortressSyncResult(false, "daily_close_hook_failed").catch(() => {});
  }
}

const LS_TWICE_SLOT = {
  morning: "or:fss:morning:",
  evening: "or:fss:evening:",
} as const;

function berlinYmdNow(): string {
  return formatInTimeZone(new Date(), BERLIN, "yyyy-MM-dd");
}

/** Twice daily: approximate morning (06–12) / evening (18–23) Berlin, once per slot per calendar day. */
export async function fortressTwiceDailyTick(): Promise<void> {
  if (!isTauriShell()) return;

  let s: ExternalBackupSettings;
  try {
    s = await fetchExternalBackupSettings();
  } catch {
    return;
  }
  if (s.schedule !== "twice_daily") return;
  if (!(s.backupPath ?? "").trim()) return;

  const ymd = berlinYmdNow();
  const hour = Number(formatInTimeZone(new Date(), BERLIN, "H"));
  if (!Number.isFinite(hour)) return;

  const trySlot = async (slot: keyof typeof LS_TWICE_SLOT): Promise<boolean> => {
    const lsKey = LS_TWICE_SLOT[slot] + ymd;
    if (localStorage.getItem(lsKey)) return false;

    const inMorning = hour >= 6 && hour < 13;
    const inEvening = hour >= 18 && hour <= 23;
    if (slot === "morning" && !inMorning) return false;
    if (slot === "evening" && !inEvening) return false;

    const r = await runExternalFortressBackup({
      backupPath: s.backupPath,
      trigger: slot === "morning" ? "slot_morgen" : "slot_abend",
    });
    await reportExternalFortressSyncResult(
      r.ok,
      r.ok ? (slot === "morning" ? "slot_morgen_ok" : "slot_abend_ok") : r.detail,
    );
    if (r.ok) localStorage.setItem(lsKey, "1");
    return true;
  };

  await trySlot("morning");
  await trySlot("evening");
}
