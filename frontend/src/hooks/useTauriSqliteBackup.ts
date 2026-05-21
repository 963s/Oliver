import { isTauriShell } from "../lib/deviceContext";

/**
 * Desktop (Tauri): persist blob via native save dialog + plugin-fs.
 * Browser: caller should fall back to object URL download (existing pattern).
 */
export async function saveBlobWithTauriDialog(blob: Blob, defaultPath: string): Promise<boolean> {
  if (!isTauriShell()) return false;
  const { save } = await import("@tauri-apps/plugin-dialog");
  const { writeFile } = await import("@tauri-apps/plugin-fs");
  const outPath = await save({
    title: "SQLite-Backup speichern",
    defaultPath,
    filters: [{ name: "SQLite", extensions: ["sqlite", "db"] }],
  });
  if (!outPath) return false;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  await writeFile(outPath, bytes);
  return true;
}
