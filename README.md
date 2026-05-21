# Oliver Roos POS

Local-first salon POS: **Express + SQLite** backend and **React (Vite) PWA** frontend. Optional **Tauri** / **Electron** shells ship the same UI.

**Important:** Run every `npm` command **from this project folder** (where this `README.md` lives). If you run them from your home directory (`~`), npm looks for `/Users/you/package.json` and fails with `ENOENT`.

```bash
cd ~/Desktop/oliver-roos-pos   # or: cd /path/to/oliver-roos-pos
```

## Quick start (web / daily work)

From the repository root:

```bash
npm install
```

**Terminal 1 — API** (default [http://127.0.0.1:3000](http://127.0.0.1:3000)):

```bash
cd ~/Desktop/oliver-roos-pos && npm run dev:backend
```

**Terminal 2 — UI** (default [http://localhost:5173](http://localhost:5173); `/api` is proxied to the backend):

```bash
cd ~/Desktop/oliver-roos-pos && npm run dev:frontend
```

Open **http://localhost:5173** in the browser.

### First-time device trust (pairing)

Production-style flow: an **owner** creates a pairing code (after login on an already trusted device) and enters it on `/pair`.

**Local development** (when the API is **not** running with `NODE_ENV=production`):

1. On the **Gerät koppeln** screen, use **„Lokal: Browser vertrauen (ohne Code)”**  
   — or, with `npm run dev:frontend`, the app will try this once automatically on `localhost`.
2. You are sent to **PIN login**. Demo staff and PINs are seeded on first DB start:

| Display | Rolle   | PIN  |
|---------|---------|------|
| OLI     | Inhaber | 1111 |
| Silke   | Stylist | 2222 |
| Abdul   | Stylist | 3333 |

(Weitere Demo-Stylisten: Mara `4444`, Jonas `5555`.)

**Disable** the dev browser endpoint on a non-production machine (e.g. staging):

```bash
export OLIVER_ROOS_DISABLE_DEV_DEVICE=1
```

**Custom** dev device secret (optional):

```bash
export OLIVER_ROOS_DEV_DEVICE_TOKEN="your-long-random-string"
```

### Environment notes

| Variable | Where | Meaning |
|----------|--------|---------|
| `PORT` | Backend | API port (default `3000`). If you change it, set `VITE_API_BASE` for the frontend when not using the Vite proxy. |
| `NODE_ENV=production` | Backend | Disables `POST /api/auth/dev-pair-browser`. |
| `AUTH_SECRET` | Backend | JWT HMAC secret; **required** (length ≥ 16) in production. |
| `VITE_API_BASE` | Frontend | API origin; leave empty in dev to use the Vite proxy. |

## Builds

```bash
npm run build -w @oliver-roos/backend
npm run build -w @oliver-roos/frontend
```

## Desktop

- **Tauri:** `npm run desktop:dev` (Rust toolchain required).
- **Electron:** `npm run electron:dev`.

## Same-origin (API serves the SPA)

Build the frontend, then run the backend with `SERVE_SPA=1` so static files are served from `frontend/dist` on the API port.
