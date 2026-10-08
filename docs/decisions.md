# Decisions

## 2026-10-09: Frontend started first (frontend only)

- **ASSUMPTION (needs confirmation):** frontend is React 18 + TypeScript + Vite, because the prototype is already
  React. This does not settle SPEC #1 for the backend, database, hosting or CI, which stay OPEN.
- Scope: a like-for-like rebuild of the prototype UI in `frontend/` (5 pages, canvas, step panel). No auth,
  persistence, audit or real approval records.
- `frontend/src/lib/mockEngine.ts` is the only code that evaluates flows, on mock rows in the browser, as in the
  prototype. It is a stand-in for compile-and-run-in-Snowflake (SPEC 7, 8). Replace its callers with the preview
  API once the compiler and backend exist. The real product must never evaluate data in the browser.
- Catalog: the UI imports `catalog/catalog.json` (a copy of the handoff output) at build time. Real publishing is OPEN (SPEC 5.1).
  The client column and `selectable: false` columns are dropped when datasets are built (`src/lib/catalog.ts`).
- Look and feel: prototype palette kept, as CSS variables in `styles.css`, so the Clear Street design system
  can be applied later (SPEC 12, OPEN whether mandatory).
- Arithmetic ops in the graph are stored as `+ - * /` (as in SPEC 6); the UI shows `+ − × ÷`.
- Not yet done from SPEC 12: keyboard and non-drag ways to connect steps (e.g. a "Takes data from" selector),
  join fan-out warning, per-step "Preview this step" action, `Needs attention` and `Draft` statuses.
