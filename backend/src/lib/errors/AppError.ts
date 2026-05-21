/**
 * Canonical application errors: stable `errorCode` for API + React clients, HTTP `statusCode`, optional `details`.
 */
const APP_ERROR_NAME = "AppError";

export type AppErrorDetails = Record<string, unknown> | unknown[] | string | number | null;

export class AppError extends Error {
  readonly name = APP_ERROR_NAME;
  readonly statusCode: number;
  readonly errorCode: string;
  readonly details?: AppErrorDetails;

  constructor(
    statusCode: number,
    errorCode: string,
    message?: string,
    details?: AppErrorDetails,
  ) {
    super(message ?? errorCode);
    Object.setPrototypeOf(this, new.target.prototype);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    if (details !== undefined) {
      this.details = details;
    }
  }

  static isAppError(e: unknown): e is AppError {
    return e instanceof AppError;
  }
}

/** Checkout / TSE / stock — used from `checkoutPipeline` and can surface to JSON. */
export const CheckoutErrorCode = {
  INSERT_INVOICE_FAILED: "INSERT_INVOICE_FAILED",
  VOUCHER_NOT_ACTIVE: "VOUCHER_NOT_ACTIVE",
  VOUCHER_EXPIRED: "VOUCHER_EXPIRED",
  VOUCHER_INSUFFICIENT_BALANCE: "VOUCHER_INSUFFICIENT_BALANCE",
  CHECKOUT_TRANSACTION_FAILED: "CHECKOUT_TRANSACTION_FAILED",
} as const;

export type CheckoutErrorCodeValue =
  (typeof CheckoutErrorCode)[keyof typeof CheckoutErrorCode];
