/**
 * Fiskaly Cloud TSE — **parallel** module; remains inactive unless
 * `system_settings.tse_provider_type = FISKALY_CLOUD` **and** `fiskaly_enabled = 1`.
 * Intentionally no auto-fallback from hardware failures to this path.
 */

import type { FiscalSignResult, TseSignInput } from "./types.js";

export async function signWithFiskalyCloud(
  input: TseSignInput,
  fiskalyEnabled: boolean,
): Promise<FiscalSignResult> {
  if (!fiskalyEnabled) {
    return {
      signature: null,
      provider: "FISKALY_CLOUD",
      tseError: {
        code: "FISKALY_DISABLED",
        message:
          "Fiskaly is disabled in system_settings (fiskaly_enabled=0). Enable in DB to use cloud TSE.",
        provider: "FISKALY_CLOUD",
      },
      exportPayload: {
        schema: "fiskaly_cloud_inactive",
        fiskalyEnabled: false,
        issuedAtMs: Date.now(),
        invoiceId: input.invoiceId,
        sessionId: input.sessionId,
      },
    };
  }
  return {
    signature: null,
    provider: "FISKALY_CLOUD",
    tseError: {
      code: "FISKALY_NOT_WIRED",
      message:
        "Fiskaly API client not yet implemented; keep fiskaly_enabled=0 in production until wired.",
      provider: "FISKALY_CLOUD",
    },
    exportPayload: {
      schema: "fiskaly_cloud_stub",
      fiskalyEnabled: true,
      issuedAtMs: Date.now(),
      invoiceId: input.invoiceId,
      sessionId: input.sessionId,
    },
  };
}
