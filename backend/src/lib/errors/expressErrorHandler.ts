import type { Express, NextFunction, Request, Response } from "express";
import { AppError } from "./AppError.js";
import { logger, serializeError } from "../logger.js";

/**
 * Last-resort Express error middleware.
 *
 * Production:  responds with a stable `{ error, code }` shape — no `err.message`, no stack.
 * Development: includes the message and stack so the developer sees the cause in DevTools.
 * Always:      writes a structured log entry with request context for support/postmortem.
 *
 * Special cases:
 *   - `AppError`:    use its `statusCode`, `errorCode`, `message`, optional `details`.
 *   - Express `err.status`/`err.statusCode`: respect the status but sanitize the body.
 *   - Zod-like errors (`name === "ZodError"` + `issues[]`): 400 with a sanitized field list.
 *   - Drizzle / SQLite-looking errors: log the full error, respond 500 generic.
 */

function isZodLikeError(err: unknown): err is { name: string; issues: Array<{ path: Array<string | number>; message: string; code?: string }> } {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: unknown; issues?: unknown };
  return e.name === "ZodError" && Array.isArray(e.issues);
}

function isDrizzleOrSqliteError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: unknown; code?: unknown; message?: unknown };
  const name = typeof e.name === "string" ? e.name : "";
  const code = typeof e.code === "string" ? e.code : "";
  const message = typeof e.message === "string" ? e.message : "";
  return (
    name.includes("Drizzle") ||
    code.startsWith("SQLITE_") ||
    message.includes("SQLITE_")
  );
}

function readExpressStatus(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { status?: unknown; statusCode?: unknown };
  for (const v of [e.status, e.statusCode]) {
    if (typeof v === "number" && v >= 400 && v <= 599) return v;
  }
  return null;
}

export function registerGlobalErrorHandler(app: Express): void {
  const isDev = process.env.NODE_ENV !== "production";

  app.use(
    (err: unknown, req: Request, res: Response, _next: NextFunction) => {
      if (res.headersSent) {
        return;
      }

      const reqCtx = {
        method: req.method,
        path: req.path,
        url: req.originalUrl,
        ip: req.ip,
      };

      // 1. Application-defined errors → keep the stable contract.
      if (AppError.isAppError(err)) {
        logger.warn("app_error", {
          ...reqCtx,
          errorCode: err.errorCode,
          statusCode: err.statusCode,
          details: err.details,
        });
        res.status(err.statusCode).json({
          error: err.errorCode,
          message: err.message,
          ...(err.details != null ? { details: err.details } : {}),
        });
        return;
      }

      // 2. Zod-style validation errors → 400 with a sanitized field list.
      if (isZodLikeError(err)) {
        const issues = err.issues.slice(0, 25).map((it) => ({
          path: it.path.join("."),
          message: it.message,
          ...(it.code ? { code: it.code } : {}),
        }));
        logger.warn("validation_error", { ...reqCtx, issues });
        res.status(400).json({
          error: "validation_failed",
          code: "ERR_VALIDATION",
          issues,
        });
        return;
      }

      // 3. Express-style status carriers → use the status, sanitize the body.
      const expressStatus = readExpressStatus(err);
      if (expressStatus !== null) {
        logger.warn("http_error", {
          ...reqCtx,
          statusCode: expressStatus,
          err: serializeError(err),
        });
        res.status(expressStatus).json({
          error: "http_error",
          code: `ERR_HTTP_${expressStatus}`,
          ...(isDev && err instanceof Error
            ? { message: err.message, stack: err.stack }
            : {}),
        });
        return;
      }

      // 4. Catch-all: 500 — never leak internals in production.
      const isDbError = isDrizzleOrSqliteError(err);
      logger.error(isDbError ? "db_error" : "unhandled_error", {
        ...reqCtx,
        err: serializeError(err),
      });
      const body: Record<string, unknown> = {
        error: "internal_server_error",
        code: "ERR_INTERNAL",
      };
      if (isDev && err instanceof Error) {
        body.message = err.message;
        body.stack = err.stack;
      }
      res.status(500).json(body);
    },
  );
}
