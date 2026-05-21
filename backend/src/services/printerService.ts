import { isValidIpv4, parsePort } from "./zvtService.js";

export type PrinterConfig = {
  printerIp: string;
  printerPort: number;
  autoPrintReceipt: boolean;
};

export function readPrinterConfig(values: Record<string, string>): PrinterConfig | null {
  const printerIp = String(values.printer_ip ?? "").trim();
  const printerPort = parsePort(String(values.printer_port ?? ""));
  const autoPrintReceipt = String(values.printer_auto_print ?? "0") === "1";
  if (!isValidIpv4(printerIp) || printerPort == null) return null;
  return { printerIp, printerPort, autoPrintReceipt };
}

/**
 * Placeholder probe for ESC/POS/network printers.
 * Designed as a safe no-op until hardware transport is wired.
 */
export async function printerConnectivityProbe(
  _cfg: PrinterConfig,
): Promise<{ ok: boolean; detail: string }> {
  return { ok: true, detail: "printer_probe_placeholder_ok" };
}
