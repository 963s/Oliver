import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";

/**
 * Structured logger for the Express backend.
 *
 * Output sinks:
 *   - Rotating file:   <LOG_DIR>/app-YYYY-MM-DD.log (7-day retention, 10 MB max per file)
 *   - Console (TTY-friendly): only in development (NODE_ENV !== "production").
 *
 * Format: line-delimited JSON with timestamp, level, message, optional context.
 * `LOG_DIR` is set by Electron's main process to `app.getPath("userData")/logs`
 * so the salon owner can hand off a single folder for support.
 *
 * Use:
 *   import { logger } from "./lib/logger.js";
 *   logger.info("session_closed", { sessionId, totalCents });
 *   logger.error("checkout_failed", { err: serializeError(err) });
 */

function resolveLogDir(): string {
  const envDir = process.env.LOG_DIR?.trim();
  if (envDir) {
    return isAbsolute(envDir) ? envDir : join(process.cwd(), envDir);
  }
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "data", "logs");
}

const logDir = resolveLogDir();
mkdirSync(logDir, { recursive: true });

const isProd = process.env.NODE_ENV === "production";

const fileTransport = new DailyRotateFile({
  dirname: logDir,
  filename: "app-%DATE%.log",
  datePattern: "YYYY-MM-DD",
  maxFiles: "7d",
  maxSize: "10m",
  zippedArchive: false,
  level: isProd ? "info" : "debug",
});

const transports: winston.transport[] = [fileTransport];
if (!isProd) {
  transports.push(
    new winston.transports.Console({
      level: "debug",
      format: winston.format.combine(
        winston.format.colorize({ all: true }),
        winston.format.timestamp({ format: "HH:mm:ss" }),
        winston.format.printf(({ level, message, timestamp, ...rest }) => {
          const ctx =
            Object.keys(rest).length > 0
              ? " " + JSON.stringify(rest, errorSafeReplacer)
              : "";
          return `${String(timestamp)} ${level} ${String(message)}${ctx}`;
        }),
      ),
    }),
  );
}

function errorSafeReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  return value;
}

export const logger = winston.createLogger({
  level: isProd ? "info" : "debug",
  defaultMeta: { service: "oliver-roos-backend" },
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json({ replacer: errorSafeReplacer }),
  ),
  transports,
  exitOnError: false,
});

/**
 * Serialize an unknown error value for structured logging.
 * Use as `logger.error("foo", { err: serializeError(e) })`.
 */
export function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
  }
  if (typeof err === "object" && err !== null) {
    return err as Record<string, unknown>;
  }
  return { value: String(err) };
}

export function getLogDir(): string {
  return logDir;
}
