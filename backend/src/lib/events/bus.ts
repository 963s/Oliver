import { EventEmitter } from "node:events";

/**
 * Typed local event bus (Node EventEmitter) for decoupling checkout from side effects
 * (future WebSockets, metrics). Handlers must not throw synchronously.
 */

export type InvoiceClosedPayload = {
  invoiceId: number;
  sessionId: number;
  staffId: number;
  totalDueCents: number;
  closedAtMs: number;
  tseProvider: string;
  tseCompliance: string | null;
};

export type TseAusfallTriggeredPayload = {
  invoiceId: number;
  sessionId: number;
  staffId: number;
};

export type HardwareJobFailedPayload = {
  jobId: number;
  jobType: string;
  retryCount: number;
  errorMessage: string;
  payload: Record<string, unknown>;
};

/** Strict event map: event name → listener argument tuple. */
export type AppEvents = {
  invoice_closed: [payload: InvoiceClosedPayload];
  tse_ausfall_triggered: [payload: TseAusfallTriggeredPayload];
  hardware_job_failed: [payload: HardwareJobFailedPayload];
};

export type AppEventName = keyof AppEvents;

export class EventDispatcher {
  private readonly emitter = new EventEmitter();

  /** Subscribe (multiple listeners allowed). */
  on<K extends AppEventName>(
    event: K,
    listener: (...args: AppEvents[K]) => void,
  ): this {
    this.emitter.on(event, listener as (...args: unknown[]) => void);
    return this;
  }

  once<K extends AppEventName>(
    event: K,
    listener: (...args: AppEvents[K]) => void,
  ): this {
    this.emitter.once(event, listener as (...args: unknown[]) => void);
    return this;
  }

  off<K extends AppEventName>(
    event: K,
    listener: (...args: AppEvents[K]) => void,
  ): this {
    this.emitter.off(event, listener as (...args: unknown[]) => void);
    return this;
  }

  emit<K extends AppEventName>(event: K, ...args: AppEvents[K]): boolean {
    return this.emitter.emit(event, ...args);
  }
}

/** Shared singleton — register listeners at module load in subscribers (future). */
export const eventBus = new EventDispatcher();
