import { EventStreamContentType, fetchEventSource } from "@microsoft/fetch-event-source";
import { pullFiscalHealthIntoStore } from "./fiscalHealthApi";
import { useCartStore } from "../store/cartStore";
import { useFiscalHealthStore } from "../store/fiscalHealthStore";
import { usePulseStore } from "../store/pulseStore";

const base = import.meta.env.VITE_API_BASE ?? "";

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: EventStreamContentType,
  };
  const token = localStorage.getItem("or:authToken");
  const device = localStorage.getItem("or:deviceToken");
  if (token) h["Authorization"] = `Bearer ${token}`;
  if (device) h["X-Device-Token"] = device;
  return h;
}

/**
 * One-way SSE: requires device + staff JWT. Uses fetch so custom headers are allowed (EventSource does not).
 */
export function startSalonEventStream(signal: AbortSignal, url = `${base}/api/events/stream`): void {
  void fetchEventSource(url, {
    signal,
    headers: authHeaders(),
    async onopen(res) {
      if (!res.ok) {
        throw new Error(`sse_http_${res.status}`);
      }
      const ct = res.headers.get("content-type");
      if (ct == null || !ct.startsWith(EventStreamContentType)) {
        throw new Error("sse.content_type");
      }
    },
    onmessage(msg) {
      if (msg.event === "invoice_closed") {
        if (msg.data) {
          try {
            const p = JSON.parse(msg.data) as { sessionId?: number };
            if (p.sessionId != null) {
              useCartStore.getState().clearCart(String(p.sessionId));
            }
          } catch {
            /* ignore bad payload */
          }
        }
        const { incrementGlobalRefreshCounter } = usePulseStore.getState();
        incrementGlobalRefreshCounter();
        return;
      }
      if (msg.event === "tse_ausfall_triggered") {
        useFiscalHealthStore.getState().markTseAusfallSse();
        usePulseStore.getState().incrementGlobalRefreshCounter();
        void pullFiscalHealthIntoStore();
        return;
      }
    },
    onerror(err) {
      if (signal.aborted) {
        return;
      }
      console.warn("SSE reconnect", err);
      return 5000;
    },
  });
}
