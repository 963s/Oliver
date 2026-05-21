import type { Express, Request, Response } from "express";
import type {
  HardwareJobFailedPayload,
  InvoiceClosedPayload,
  TseAusfallTriggeredPayload,
} from "../lib/events/bus.js";
import { eventBus } from "../lib/events/bus.js";
import { getStaffContext } from "../lib/sessionAuth.js";

/**
 * §26 — LAN real-time: SSE bridge from local `eventBus` (one-way server → clients).
 * Protected by global device guard + JWT (`getStaffContext`).
 */
export function registerSseEventRoutes(app: Express): void {
  app.get("/api/events/stream", (req: Request, res: Response) => {
    try {
      getStaffContext(req);
    } catch {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    const resFlush = res as Response & { flushHeaders?: () => void };
    resFlush.flushHeaders?.();

    let cleaned = false;
    let ping: ReturnType<typeof setInterval> | undefined;

    const writeEvent = (event: string, payload: unknown) => {
      try {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      } catch {
        cleanup();
      }
    };

    function onInvoiceClosed(p: InvoiceClosedPayload) {
      writeEvent("invoice_closed", p);
    }
    function onAusfall(p: TseAusfallTriggeredPayload) {
      writeEvent("tse_ausfall_triggered", p);
    }
    function onHwFail(p: HardwareJobFailedPayload) {
      writeEvent("hardware_job_failed", p);
    }

    function cleanup() {
      if (cleaned) return;
      cleaned = true;
      if (ping) clearInterval(ping);
      eventBus.off("invoice_closed", onInvoiceClosed);
      eventBus.off("tse_ausfall_triggered", onAusfall);
      eventBus.off("hardware_job_failed", onHwFail);
    }

    eventBus.on("invoice_closed", onInvoiceClosed);
    eventBus.on("tse_ausfall_triggered", onAusfall);
    eventBus.on("hardware_job_failed", onHwFail);

    writeEvent("ready", { ok: true });

    ping = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {
        cleanup();
      }
    }, 25_000);

    req.on("close", cleanup);
    res.on("close", cleanup);
  });
}
