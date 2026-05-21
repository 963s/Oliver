/**
 * §10.12 — Hybrid TSE middleware: Epson hardware first → Fiskaly cloud → TSE-Ausfall marker.
 * SDK wiring remains mocked/stubbed in lower layers; this module owns try/catch fallback order.
 *
 * This layer **returns** `FiscalSignResult` (incl. `tseError`) and does not throw for provider
 * failures. Use `AppError` only in HTTP/transactional layers (e.g. `checkoutPipeline`) for
 * client-bound failures.
 */

import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../../db/schema.js";
import { signWithFiskalyCloud } from "../../modules/fiscal/fiskalyProvider.js";
import { signWithPrinterTse } from "../../modules/fiscal/printerTseProvider.js";
import { isFiskalyEnabled } from "../../modules/fiscal/tseSettings.js";
import type { FiscalSignResult, TseHybridMeta, TseSignInput } from "../../modules/fiscal/types.js";

async function signViaHardwareTse(input: TseSignInput): Promise<FiscalSignResult> {
  try {
    return await signWithPrinterTse(input);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      signature: null,
      provider: "HARDWARE_PRINTER",
      tseError: {
        code: "HARDWARE_SIGN_EXCEPTION",
        message,
        provider: "HARDWARE_PRINTER",
      },
      exportPayload: {
        schema: "hardware_tse_exception_v0",
        invoiceId: input.invoiceId,
        issuedAtMs: Date.now(),
      },
    };
  }
}

async function signViaCloudTse(
  db: BetterSQLite3Database<typeof schema>,
  input: TseSignInput,
): Promise<FiscalSignResult> {
  try {
    return await signWithFiskalyCloud(input, isFiskalyEnabled(db));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      signature: null,
      provider: "FISKALY_CLOUD",
      tseError: {
        code: "CLOUD_SIGN_EXCEPTION",
        message,
        provider: "FISKALY_CLOUD",
      },
      exportPayload: {
        schema: "fiskaly_cloud_exception_v0",
        invoiceId: input.invoiceId,
        issuedAtMs: Date.now(),
      },
    };
  }
}

function withHybrid(base: FiscalSignResult, hybrid: TseHybridMeta): FiscalSignResult {
  return { ...base, hybrid };
}

function hasSignature(r: FiscalSignResult): boolean {
  return typeof r.signature === "string" && r.signature.trim().length > 0;
}

/**
 * Unified fiscal signing: stress harness → hardware LAN TSE → cloud TSE → Ausfall marker.
 */
export async function signFiscalTransaction(
  db: BetterSQLite3Database<typeof schema>,
  input: TseSignInput,
): Promise<FiscalSignResult> {
  /**
   * `OLIVER_ROOS_CORE_STRESS_TSE` — deterministic TSE without LAN/printer (audits / local integration).
   * `fail` = no signature (draft). `ok` = synthetic signature + mocked hybrid metadata.
   */
  const stress = process.env.OLIVER_ROOS_CORE_STRESS_TSE?.trim();
  if (stress === "fail") {
    return {
      provider: "HARDWARE_PRINTER",
      signature: null,
      exportPayload: { source: "core_stress" },
      tseError: {
        code: "core_stress_mock",
        message: "OLIVER_ROOS_CORE_STRESS_TSE=fail (integration test)",
        provider: "HARDWARE_PRINTER",
      },
    };
  }
  if (stress === "ok") {
    const now = new Date();
    return {
      provider: "HARDWARE_PRINTER",
      signature: "STRESS|MOCK|KASSENSICHV_OK",
      exportPayload: { source: "core_stress", invoiceId: input.invoiceId },
      hybrid: {
        tseStatus: "signed_hardware",
        tseTransactionId: `STRESS-TXN-${input.invoiceId}`,
        tseSignatureNumber: "STRESS-SN-1",
        tseStartTime: now,
        tseEndTime: now,
      },
    };
  }

  const hw = await signViaHardwareTse(input);
  if (hasSignature(hw)) {
    const now = new Date();
    return withHybrid(hw, {
      tseStatus: "signed_hardware",
      tseTransactionId: `HW-${input.invoiceId}-${now.getTime()}`,
      tseSignatureNumber: "1",
      tseStartTime: now,
      tseEndTime: now,
    });
  }

  const cloud = await signViaCloudTse(db, input);
  if (hasSignature(cloud)) {
    const now = new Date();
    return withHybrid(cloud, {
      tseStatus: "signed_cloud",
      tseTransactionId: `FK-${input.invoiceId}-${now.getTime()}`,
      tseSignatureNumber: "1",
      tseStartTime: now,
      tseEndTime: now,
    });
  }

  const now = new Date();
  const ausfallSig = `TSE-AUSFALL|invoice=${input.invoiceId}|ts=${now.getTime()}`;
  return {
    signature: ausfallSig,
    provider: "HARDWARE_PRINTER",
    exportPayload: {
      schema: "tse_ausfall_v0",
      invoiceId: input.invoiceId,
      sessionId: input.sessionId,
      reason: "hardware_and_cloud_unavailable",
      attemptedHardware: {
        tseError: hw.tseError,
        exportSchema: hw.exportPayload.schema,
      },
      attemptedCloud: {
        tseError: cloud.tseError,
        exportSchema: cloud.exportPayload.schema,
      },
      issuedAtMs: now.getTime(),
    },
    hybrid: {
      tseStatus: "ausfall_failed",
      tseTransactionId: null,
      tseSignatureNumber: null,
      tseStartTime: now,
      tseEndTime: now,
    },
  };
}

export const signInvoiceFiscal = signFiscalTransaction;
