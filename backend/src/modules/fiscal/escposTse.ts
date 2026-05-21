/**
 * ESC/POS helpers for **LAN** thermal printers with integrated TSE (Epson/Star, BSI-listed models).
 * Real KassenSichV TSE telegrams are device-specific; this module defines a **portable frame**
 * (init + payload + optional status poll) to be extended with manufacturer bytes / SDK.
 */

import type { TseSignInput } from "./types.js";

const ESC = 0x1b;
const GS = 0x1d;

/** Standard init: clear buffer, select default line spacing. */
export function escposInitialize(): Buffer {
  return Buffer.from([ESC, 0x40]);
}

/**
 * Build a human-readable “data block” for the signing operation (for logging / device binding).
 * Device firmware may require a different binary layout — replace/extend per printer family.
 */
export function buildKassenSichVPlaintextBlock(input: TseSignInput): string {
  const head = `KASSENSICHV_TSE_V1;invoice=${input.invoiceId};session=${input.sessionId}`;
  const tot = `;gross_cents=${input.totals.grossCents};net_cents=${input.totals.netCents};vat_cents=${input.totals.vatCents}`;
  const lines = input.lines
    .map(
      (l) =>
        `|${l.description}\t${l.quantity}\t${l.unitNetCents}\t${l.vatRateBps}\t${l.lineNetCents}\t${l.lineVatCents}`,
    )
    .join("\n");
  return `${head}${tot}\n${lines}\n`;
}

/** UTF-8 text as raw print bytes (many fiscal printers need code page — override per device). */
export function escposPrintUtf8TextBlock(text: string): Buffer {
  return Buffer.concat([escposInitialize(), Buffer.from(text, "utf8"), Buffer.from([0x0a, 0x0a])]);
}

/**
 * Placeholder: **GS ( H** style 2D / TSE request — real opcodes come from the printer / TSE manual.
 * Returns a buffer that is safe to send in dev (no cut) to exercise LAN connectivity.
 */
export function buildTseSignRequestBuffer(input: TseSignInput): Buffer {
  const body = buildKassenSichVPlaintextBlock(input);
  const textPart = escposPrintUtf8TextBlock(body);
  const placeholderPoll = Buffer.from([GS, 0x1b, 0x1e, 0x0a]); // generic “poll” placeholder
  return Buffer.concat([textPart, placeholderPoll]);
}
