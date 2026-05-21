import type { Express, NextFunction, Request, Response } from "express";
import { AppError } from "./AppError.js";

/**
 * Last middleware: structured JSON for `AppError`, legacy `status` on ad-hoc errors, 500 fallback.
 */
export function registerGlobalErrorHandler(app: Express): void {
  app.use(
    (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
      if (res.headersSent) {
        return;
      }
      if (AppError.isAppError(err)) {
        res.status(err.statusCode).json({
          error: err.errorCode,
          message: err.message,
          ...(err.details != null ? { details: err.details } : {}),
        });
        return;
      }
      if (
        err &&
        typeof err === "object" &&
        "status" in err &&
        typeof (err as { status?: number }).status === "number"
      ) {
        const status = (err as { status: number }).status;
        const message =
          err instanceof Error ? err.message : "Server error";
        res.status(status).json({ error: message });
        return;
      }
      const message = err instanceof Error ? err.message : "Server error";
      res
        .status(500)
        .json({ error: "INTERNAL_ERROR", message });
    },
  );
}
