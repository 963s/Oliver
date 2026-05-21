/**
 * §Hardware-first — TSE via thermal printer (LAN, typically port 9100).
 * No internet; failures stay local and are reported to the caller (no cloud fallback here).
 */

import { createConnection } from "node:net";
import { buildTseSignRequestBuffer } from "./escposTse.js";
import type { FiscalSignResult, TseSignInput, TseProviderTypeValue } from "./types.js";

const PROVIDER: TseProviderTypeValue = "HARDWARE_PRINTER";

function readHostPort(): { host: string; port: number } | null {
  const host = process.env.TSE_PRINTER_HOST?.trim();
  if (!host) return null;
  const port = Math.floor(Number(process.env.TSE_PRINTER_PORT ?? "9100"));
  if (!Number.isFinite(port) || port < 1) return { host, port: 9100 };
  return { host, port };
}

function sendBufferOverLan(
  host: string,
  port: number,
  data: Buffer,
  readTimeoutMs: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let settled = false;
    const sock = createConnection({ host, port, family: 0 });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(Buffer.concat(chunks));
    }, readTimeoutMs);
    sock.on("data", (c) => chunks.push(c as Buffer));
    sock.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.destroy();
      reject(err);
    });
    sock.on("connect", () => {
      sock.write(data, (e) => {
        if (e && !settled) {
          settled = true;
          clearTimeout(timer);
          sock.destroy();
          reject(e);
        }
      });
    });
  });
}

/**
 * Attempt LAN signing: sends ESC/POS TSE request buffer; parses **no** vendor TSE block yet (level 1).
 * Returns `tseError` on configuration / network failure only.
 */
export async function signWithPrinterTse(
  input: TseSignInput,
): Promise<FiscalSignResult> {
  const target = readHostPort();
  const request = buildTseSignRequestBuffer(input);
  const now = Date.now();

  if (!target) {
    return {
      signature: null,
      provider: PROVIDER,
      tseError: {
        code: "HARDWARE_NO_PRINTER_HOST",
        message:
          "Set TSE_PRINTER_HOST (and optionally TSE_PRINTER_PORT) for LAN thermal TSE.",
        provider: PROVIDER,
      },
      exportPayload: {
        schema: "hardware_tse_lan_v0",
        provider: PROVIDER,
        hostConfigured: false,
        issuedAtMs: now,
        requestBytes: request.length,
      },
    };
  }

  const readMs = Math.min(
    Math.max(2000, Number(process.env.TSE_LAN_READ_MS ?? "5000") || 5000),
    30_000,
  );

  try {
    const response = await sendBufferOverLan(
      target.host,
      target.port,
      request,
      readMs,
    );
    const hasBytes = response.length > 0;
    /** Level 1: BSI TSE block parsing is device-specific; no `signature` until parser exists. */
    return {
      signature: null,
      provider: PROVIDER,
      exportPayload: {
        schema: "hardware_tse_lan_v0",
        provider: PROVIDER,
        host: target.host,
        port: target.port,
        issuedAtMs: now,
        bytesSent: request.length,
        bytesReceived: response.length,
        hasResponse: hasBytes,
        note: hasBytes
          ? "LAN response received; TSE block parser not yet implemented (signature still null)."
          : "No response from printer within window; TSE not finalized.",
      },
    };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return {
      signature: null,
      provider: PROVIDER,
      tseError: {
        code: "HARDWARE_LAN_ERROR",
        message: err,
        provider: PROVIDER,
      },
      exportPayload: {
        schema: "hardware_tse_lan_v0",
        provider: PROVIDER,
        host: target.host,
        port: target.port,
        issuedAtMs: now,
        requestBytes: request.length,
        networkError: err,
      },
    };
  }
}
