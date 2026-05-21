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
| **One-step setup (SSH key on client)** | `npm run setup:client` |
| **One-step deploy (build + publish + install on client)** | `npm run deploy:client` |
| Just update the client (no rebuild) | `npm run update:client` |

`electron-builder` publishes to GitHub Releases on `963s/Oliver`. Releases come out as **draft** — `scripts/deploy-client.sh` promotes the latest one to `published` via the GitHub API so `electron-updater` / the in-app banner can see it.

**The app is not Apple-signed** (no Developer ID). Consequence: macOS Gatekeeper blocks any kind of background auto-install. The in-app `UpdateBanner` only links the user to the manual DMG download. The **only fully-automated path** is `npm run deploy:client`, which SSHes into the salon Mac with a dedicated ed25519 key (set up once via `npm run setup:client`) and runs `scripts/update-client.sh` to replace the .app + strip quarantine.

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

## Salon machine

- Target: **Intel iMac** (older, x64 only — not Apple Silicon). Build both arches but only x64 DMG (`Oliver Roos Friseur-X.Y.Z.dmg`, **no** `-arm64`) goes to the salon.
- SSH alias: `oliver-client` (configured by `scripts/setup-ssh-key.sh`). Defaults: user `Oli`, host `100.109.12.48` (Tailscale).
- DB lives at `~/Library/Application Support/Oliver Roos Friseur/salon.db` on the client. `update-client.sh` searches all `/Users/*/Library/...` paths in case the macOS account was renamed and the home dir didn't move with it.

## Repo

- GitHub: `963s/Oliver` (private). Releases drive the in-app update banner.
- Default branch: `main`.
