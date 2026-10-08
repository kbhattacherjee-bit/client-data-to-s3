import { emit } from './emit';
import { buildPlan } from './plan';
import { summarise } from './summary';
import { CompileError, type Catalog, type CompileOptions, type CompileParams, type CompileResult, type Issue } from './types';

export * from './types';
export { quoteIdent, OUTPUT_NAME_RE } from './identifiers';
export { OPS_BY_TYPE, OP_PHRASE, arityOf } from './plan';

/** Checks a graph without producing SQL. Backs POST /api/requests/:id/validate. */
export function validate(graph: unknown, catalog: Catalog, params: CompileParams, options: CompileOptions = {}): { ok: boolean; issues: Issue[]; warnings: string[] } {
  const { issues, warnings } = buildPlan(graph, catalog, params, options);
  return { ok: issues.length === 0, issues, warnings };
}

/**
 * Pure and deterministic: no I/O, no clock, no randomness. The same graph, catalog and params always
 * give the same SQL, so the SQL a human approves can be hashed and is exactly what runs.
 * Throws CompileError with every problem found.
 */
export function compile(graph: unknown, catalog: Catalog, params: CompileParams, options: CompileOptions = {}): CompileResult {
  const { issues, warnings, plan } = buildPlan(graph, catalog, params, options);
  if (!plan || issues.length) throw new CompileError(issues);
  const physical = options.physicalCase ?? 'upper';
  const named = emit(plan, params.client, params.runDate, physical, 'named');
  const qmark = emit(plan, params.client, params.runDate, physical, 'qmark');
  return {
    sql: named.sql,
    params: named.params,
    positional: { sql: qmark.sql, binds: qmark.binds },
    outputColumns: plan.output.cols.map((c) => ({ name: c.name, type: c.type })),
    summary: summarise(plan),
    warnings,
    delivery: { client: plan.output.client, folder: plan.output.folder, fmt: plan.output.fmt },
  };
}
