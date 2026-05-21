# Oliver Roos Friseur — POS & Inventory

Offline-first Electron desktop app for a German barbershop (appointment + inventory management). Production target: a Mac in the salon. End user is non-technical, so updates must be silent and automatic.

## Architecture

- **`electron/`** — Electron main process (`main.mjs`), preload, app icons. Spawns the backend Express server in-process and loads the frontend bundle. Owns the auto-updater.
- **`backend/`** — Node + Express + `better-sqlite3` + Drizzle ORM. SQLite DB lives in user data directory (offline; not in repo).
- **`frontend/`** — React 18 + Vite + Tailwind v4 + Zustand. Routed via `react-router-dom`. Animations via `framer-motion`.
- **`backend-bundle/`** — Pre-bundled backend artifacts copied into the Electron build (see `scripts/prepare-pack.mjs`).
- **`release/`** — electron-builder output (gitignored).
- npm workspaces: root `package.json` owns `backend` and `frontend` as workspaces.

## Build & release

| Task | Command |
|---|---|
| Dev backend | `npm run dev:backend` |
| Dev frontend | `npm run dev:frontend` |
| Dev Electron shell | `npm run electron:dev` |
| Local pack (no publish) | `npm run electron:pack` |
| **Publish release to GitHub** | `npm run electron:release` |
| Bump patch + push tags | `npm run release:patch` |

`electron-builder` publishes to GitHub Releases on `963s/Oliver`. The installed app polls every ~4h via `electron-updater` and installs in the background. **Bumping `version` in root `package.json` is what triggers the update on end-user machines** — do not forget it.

The GitHub token for publishing must be passed via the `GH_TOKEN` env var at release time. **Never commit it.** If you see a token in chat, treat it as compromised and tell the user to revoke it.

## Key constraints

- **Offline-first.** No cloud DB. All persistence is local SQLite via Drizzle.
- **End user cannot debug.** Errors must be handled gracefully — surface a login redirect or a user-friendly toast, never a stack trace.
- **Soft delete only** for inventory/products — historical invoices reference these rows and must remain readable. Manual stock adjustments must be logged with a reason for auditability.
- **`AUTH_SECRET` must persist across launches** — it's written to `userData/` on first run and reused. Regenerating it invalidates every session token.
- **Performance matters on Intel Macs.** Avoid `backdrop-blur` and other GPU-heavy CSS filters. Use solid/transparent backgrounds instead.
- **UI targets a 21" salon display.** Window opens maximized. Typography is fluid (`clamp()` in `frontend/src/index.css`) and scales up on ≥1920px viewports — don't hardcode pixel font sizes that fight this.

## Conventions

- Commit style: short prefix + scope-free summary (`fix: ...`, `feat: ...`, `chore: ...`). See `git log`.
- Language: code/UI strings are German (`Zählkorrektur`, etc.). Comments in code can be English.
- `DECISIONS.md` is the long-form rationale log — append, don't rewrite.

## Repo

- GitHub: `963s/Oliver` (private). Releases drive auto-update.
- Default branch: `main`.
