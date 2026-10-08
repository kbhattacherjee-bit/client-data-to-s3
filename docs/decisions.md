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

## 2026-10-09: SQL compiler (Phase 1) in TypeScript

- **DECIDED (by the user):** the compiler is TypeScript, in `packages/compiler`, as a pure library. The same code
  runs in the browser for a live SQL preview and on the server for the authoritative compile. **The server must
  recompile the submitted graph itself; the SQL it stores, hashes and shows the approver is never taken from the
  browser.** This fixes the compiler language only; backend framework, database and hosting (SPEC #1) stay OPEN.
- Scope: source, select, filter, S3. `group`, `addcol`, `join`, `union` return `UNSUPPORTED_STEP` until Phase 2.
  `select` with `extras` returns `NEEDS_DATA_ENG` (it routes to data engineering, it is not compiled).
- Bind style: `:name` binds in `sql` (what is approved and hashed) plus a `positional` (`?`) copy for drivers that
  need it. Which one the Snowflake client uses depends on the driver chosen with the backend.
- **ASSUMPTION:** physical names are upper case in Snowflake (dbt creates them unquoted), so source reads use
  `"COMMISSION" AS "commission"`. Option `physicalCase` ('upper' | 'lower' | 'preserve'). Confirm with SPEC #7.
- **ASSUMPTION:** the catalog `table` is `schema.model` with no database; the session's default database is used.
- Client key: the request's client is `params.client`, must be in `params.allowedClients`, and must equal the S3
  step's client. The client string is assumed to equal the `client_id` column value (SPEC #5 OPEN).
- Run date (SPEC #4, still OPEN): implemented behind the proposal. A model with `date_column` in the catalog and a
  `runDate` param gets `AND <date_column> = TO_DATE(:run_date)`. Nothing changes until the catalog has `date_column`.
- Filter type rules (new, stricter than the prototype, which silently ignored bad input): numbers need a numeric
  value; `gt`/`lt` apply to number, date and timestamp only; `contains` applies to text only; booleans take
  `true`/`false`. A rule with an empty value is ignored with a warning (SPEC 7). Tell me if text `gt`/`lt` is needed.
- Not in the compiler yet: `sql_hash` (computed server-side where the hash is stored), stable row order (SPEC #10),
  join fan-out warning (Phase 2). Output step accepts `CSV` or `Parquet` as the prototype does (SPEC #10).
- Verified that generated SQL parses with sqlglot's Snowflake dialect. **Not yet run on a real Snowflake account.**
- Frontend wiring (2026-10-09): `frontend/src/lib/sql.ts` imports the compiler from `packages/compiler/src` for a
  display-only SQL tab, SQL review on Approvals, per-step issue messages, and a submit block for real errors.
  Not blocking submit: unsupported step types, `NEEDS_DATA_ENG` and unconnected steps. The real server recompiles.

## 2026-10-09: Filter groups and richer group by (resolves SPEC open item #13)

- **DECIDED (by the user):** group by takes several columns and a separate function per column. Filter rules can
  combine with AND or OR, and rules can contain nested groups. Not copied from the prototype, which had one column,
  one function for every number column, and AND only.
- Filter cfg: `{ match: 'all' | 'any', rules: (Rule | { match, rules })[] }`, nested at most 3 levels, at most 50
  rules. Nested groups are always parenthesised in SQL. An empty-value rule is dropped from its group; a group left
  empty is dropped. An ignored rule never makes an `any` group pass everything. Old graphs without `match` mean `all`.
- Group cfg: `{ by: string[], aggs: [{ col, fn, as? }] }` with fn in sum, avg, min, max, count, count_distinct.
  sum and avg need a number column; min and max take number, date or timestamp; count and count_distinct take any
  column. Default output name is `<fn>_<col>`, renameable, unique, `^[a-z][a-z0-9_]*$`. sum and avg round to 2
  decimals as in the prototype. `count` counts non-empty values. The old shape `{ by: string, agg }` is rejected.
- **DECIDED (by the user):** no automatic `row_count` column. A count is available as a Count total on any column.
- The compiler now also covers the `group` step (it was Phase 2). `addcol`, `join` and `union` are still not compiled.
- Filter `match` and `group` shapes must be added to SPEC section 6 when that document is next revised; `claude.md`
  at the project root still describes the old shapes.

## 2026-10-09: More filter operators

- **DECIDED (by the user):** filters offer the usual comparisons, not just greater/less/equals/contains.
- Operators: equals, does not equal, greater than, at least (>=), less than, at most (<=), between (inclusive),
  is one of, is not one of, contains, does not contain, starts with, ends with, is blank, is not blank.
- Allowed by column type (`OPS_BY_TYPE` in the compiler, also used by the UI): number, date and timestamp take the
  comparisons, between, in lists and blank checks; text takes equals, contains, starts/ends with, lists and blank
  checks (not greater/less); boolean takes equals and blank checks.
- Rule shape: `{ col, op, val, val2?, vals? }` (`val2` is the upper end of between, `vals` the list). A list holds at
  most 100 values; values containing commas can be entered one at a time.
- "Is blank" on a text column means missing or empty string; on other types it means missing. Like SQL, "does not
  equal", "is not one of" and "does not contain" do not return rows where the value is missing.
- A rule with no value is still ignored with a warning (SPEC 7); blank checks need no value and are never ignored.
  `between` with only one end filled is an error.
- Not added: regex, case-sensitive matching, relative dates ("last 7 days"), comparing two columns.
