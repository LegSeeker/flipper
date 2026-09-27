# Flipper — notes for contributors and AI agents

Local-first PWA (React 19 + TypeScript + Vite + Tailwind 4 + Dexie). Read `docs/ARCHITECTURE.md` before larger changes.

## Commands

- `npm run check` — typecheck + lint + unit tests (run before every commit)
- `npm run test:e2e` — Playwright (builds and serves `dist/` on :4173)
- `npm run format` — Prettier (CI runs `format:check`)

## Rules

- All database writes go through `src/db/repo.ts` (timestamps, codes, status side effects, tombstones). Never call `db.<table>.put/add/delete` from components.
- Changing Dexie indexes needs a new `this.version(n)` in `src/db/db.ts`; never edit a shipped version. New non-indexed fields just need a default in `db/defaults.ts` (settings are merged with defaults on read).
- Money/profit logic belongs in `src/lib/calc.ts` / `src/lib/stats.ts` as pure functions with tests.
- AI output that is saved must be validated with zod in `src/ai/tasks.ts`.
- Secrets (API keys, proxy token, Google client ID) live in `LocalSettings` only — never in `Settings`, snapshots, backups or logs.
- Keep docs (README, docs/ARCHITECTURE.md, proxy/README.md) in step with behaviour changes.
- Playwright is pinned to 1.56.1 to match the Chromium preinstalled in Claude Code cloud sessions (`/opt/pw-browsers`).
