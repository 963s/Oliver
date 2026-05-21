/**
 * Shared types for TSE / KassenSichV signing (hardware + cloud adapters).
 */

export type TseSignInput = {
  invoiceId: number;
  sessionId: number;
  totals: {
    netCents: number;
    vatCents: number;
    grossCents: number;
  };
  lines: {
    description: string;
    quantity: number;
    unitNetCents: number;
    vatRateBps: number;
    lineNetCents: number;
    lineVatCents: number;
  }[];
};

/** See `system_settings.tse_provider_type` */
export type TseProviderTypeValue = "HARDWARE_PRINTER" | "FISKALY_CLOUD";

export const TSE_PROVIDER_DEFAULT: TseProviderTypeValue = "HARDWARE_PRINTER";

export const SETTING_TSE_PROVIDER_TYPE = "tse_provider_type";
export const SETTING_FISKALY_ENABLED = "fiskaly_enabled";

export type TseErrorInfo = {
  code: string;
  message: string;
  /** Which adapter was used when the error occurred */
  provider: string;
};

/** KassenSichV hybrid middleware outcome (§10.12). */
export type TseComplianceStatus =
  | "signed_hardware"
  | "signed_cloud"
  | "ausfall_failed";

export type TseHybridMeta = {
  tseStatus: TseComplianceStatus;
  tseTransactionId: string | null;
  tseSignatureNumber: string | null;
  tseStartTime: Date;
  tseEndTime: Date;
};

/**
 * Outcome of `signInvoiceFiscal` / `signFiscalTransaction`.
 * — Normal close: non-empty `signature` from hardware or cloud TSE.
 * — **TSE-Ausfall:** non-empty marker `signature` (`TSE-AUSFALL|…`) with `hybrid.tseStatus === ausfall_failed`
 *   so checkout can close legally while logging `tse_ausfall_detected`.
 * — **Draft / 202:** `signature` null and `tseError` set (e.g. stress test `fail`, unrecoverable signer).
 */
export type FiscalSignResult = {
  signature: string | null;
  exportPayload: Record<string, unknown>;
  provider: TseProviderTypeValue;
  tseError?: TseErrorInfo;
  hybrid?: TseHybridMeta;
};
