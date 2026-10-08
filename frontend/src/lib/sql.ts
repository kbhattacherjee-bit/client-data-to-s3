import { compile, CompileError, type CompileResult, type Issue } from '../../../packages/compiler/src';
import { clients, compilerCatalog } from './catalog';
import type { Graph } from './types';

export type SqlOutcome = { ok: true; result: CompileResult } | { ok: false; issues: Issue[] };

/**
 * Live SQL for the preview tab and the approvals page. This is for display only: the server must
 * recompile the submitted graph itself and store that SQL (see docs/decisions.md).
 */
export function compileFlow(graph: Graph, client?: string): SqlOutcome {
  const s3 = graph.nodes.find((n) => n.type === 's3');
  try {
    return {
      ok: true,
      result: compile(graph, compilerCatalog, { client: client ?? s3?.cfg.client ?? '', allowedClients: Object.keys(clients) }),
    };
  } catch (e) {
    if (e instanceof CompileError) return { ok: false, issues: e.issues };
    throw e;
  }
}

/** Not errors in the flow: either handled elsewhere (data engineering, incomplete flows) or a step type the compiler does not cover yet. */
const NOT_BLOCKING = new Set(['UNSUPPORTED_STEP', 'NEEDS_DATA_ENG', 'MISSING_INPUT']);

/** The first problem that should stop a submit, or undefined. */
export function firstBlocking(o: SqlOutcome): Issue | undefined {
  return o.ok ? undefined : o.issues.find((i) => !NOT_BLOCKING.has(i.code));
}
