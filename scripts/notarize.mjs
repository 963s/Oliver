/**
 * scripts/notarize.mjs
 * macOS Notarisierung — nur aktiv wenn CSC_LINK gesetzt ist (Code-Signing).
 * Ohne Signing-Zertifikat: wird still übersprungen.
 */
export default async function notarize(_context) {
  // Nur macOS
  if (process.platform !== "darwin") return;

  // Nur wenn ein Apple-Signing-Zertifikat konfiguriert ist
  if (!process.env.APPLE_ID || !process.env.APPLE_APP_SPECIFIC_PASSWORD) {
    console.log("[notarize] Übersprungen — kein APPLE_ID gesetzt.");
    return;
  }

  const { notarize } = await import("@electron/notarize");
  const appBundleId = "com.oliverroos.salon.pos";
  const appPath = _context.appOutDir + "/Oliver Roos POS.app";

  console.log("[notarize] Starte Notarisierung für:", appPath);
  await notarize({
    appBundleId,
    appPath,
    appleId:             process.env.APPLE_ID,
    appleIdPassword:     process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId:              process.env.APPLE_TEAM_ID ?? "",
  });
  console.log("[notarize] Fertig.");
}
