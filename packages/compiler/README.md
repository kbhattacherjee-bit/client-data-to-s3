# @client-reports/compiler

Pure TypeScript: `compile(graph, catalog, params, options) -> { sql, params, positional, outputColumns, summary, warnings, delivery }`.
No I/O, no clock, no randomness, no framework. Runs in the browser (preview) and in Node (authoritative compile).

```
npm install
npm test           # golden SQL, injection, client isolation, validation
npm run typecheck
```

Safety rules (SPEC section 7), each covered by tests:
1. Identifiers come from the catalog only and are always quoted (`src/identifiers.ts`).
2. Every value (filter values, client, run date) is a bind parameter.
3. The client predicate is added in each client-scoped source CTE, before any other step.
4. Only allow-listed step types exist; the graph is treated as untrusted JSON.

Phase 1 steps: `source`, `select`, `filter`, `s3`. See `docs/decisions.md` for assumptions.
