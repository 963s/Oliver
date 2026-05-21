import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { openDb } from "./db/index.js";
import { startHardwareJobDrainLoop } from "./lib/hardware/jobQueue.js";
import { registerGlobalErrorHandler } from "./lib/errors/expressErrorHandler.js";
import { registerApi, ensureSeedData } from "./routes/api.js";
import { ensureEmbeddedTrustedDevice } from "./lib/embeddedTrustedDevice.js";
import { isDevBrowserDeviceRouteEnabled } from "./lib/auth/deviceAuth.js";
// Demo seed disabled — production mode (real salon data only)

const app = express();
app.use(cors());
app.use(express.json({ limit: "512kb" }));

const db = openDb(true);
ensureEmbeddedTrustedDevice(db);
ensureSeedData(db);
// applyEliteClientSeed(db); // disabled: salon is in live production mode
registerApi(app, db);
startHardwareJobDrainLoop(db);

/** Electron / desktop: single origin — serve the Vite build from the same :PORT as the API. */
if (process.env.SERVE_SPA) {
  const here = dirname(fileURLToPath(import.meta.url));
  const staticDir = process.env.FRONTEND_PATH || join(here, "..", "..", "frontend", "dist");
  if (existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get(/.*/, (req, res, next) => {
      if (req.path.startsWith("/api")) {
        next();
        return;
      }
      res.sendFile(join(staticDir, "index.html"));
    });
  } else {
    console.warn("SERVE_SPA: frontend dist not found at", staticDir);
  }
}

registerGlobalErrorHandler(app);

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`Oliver Roos Frisuren — API auf Port ${port}`);
  if (isDevBrowserDeviceRouteEnabled()) {
    console.log(
      "[dev] POST /api/auth/dev-pair-browser — trust this browser for PIN login (off in production or when OLIVER_ROOS_DISABLE_DEV_DEVICE=1).",
    );
  }
});
