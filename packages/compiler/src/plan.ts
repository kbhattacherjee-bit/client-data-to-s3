import { OUTPUT_NAME_RE } from './identifiers';
import type { Catalog, CatalogColumn, CatalogModel, ColType, CompileOptions, CompileParams, FilterOp, Issue, IssueCode, ParamValue } from './types';

export const DEFAULT_MAX_NODES = 50;
const MAX_RULES = 50;
const MAX_DEPTH = 3;
const MAX_AGGS = 50;
const MAX_VALUE_LENGTH = 500;

type Port = 'in' | 'a' | 'b';
const PORTS: Record<string, Port[]> = {
  source: [], select: ['in'], filter: ['in'], group: ['in'], addcol: ['in'], join: ['a', 'b'], union: ['a', 'b'], s3: ['in'],
};
/** Phase 1 (SPEC section 14). The rest are recognised so the error is clear, not "unknown". */
const SUPPORTED = new Set(['source', 'select', 'filter', 'group', 's3']);

const COMPARE: FilterOp[] = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between', 'in', 'not_in', 'is_null', 'is_not_null'];
/** Which comparisons each column type allows. The UI reads this too, so the two cannot drift apart. */
export const OPS_BY_TYPE: Record<ColType, FilterOp[]> = {
  number: COMPARE,
  date: COMPARE,
  timestamp: COMPARE,
  text: ['eq', 'ne', 'contains', 'not_contains', 'starts_with', 'ends_with', 'in', 'not_in', 'is_null', 'is_not_null'],
  boolean: ['eq', 'ne', 'is_null', 'is_not_null'],
};
export type Arity = 'none' | 'one' | 'two' | 'list';
export const arityOf = (op: FilterOp): Arity =>
  op === 'is_null' || op === 'is_not_null' ? 'none' : op === 'between' ? 'two' : op === 'in' || op === 'not_in' ? 'list' : 'one';
const ALL_OPS = Object.values(OPS_BY_TYPE).flat();
const MAX_LIST = 100;

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?)?$/;
const NUMBER_RE = /^-?\d+(\.\d+)?$/;

export interface Col { name: string; type: ColType }
export type Cond =
  | { kind: 'rule'; col: string; colType: ColType; op: FilterOp; values: ParamValue[] }
  | { kind: 'group'; match: 'all' | 'any'; items: Cond[] };
export type AggFn = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'count_distinct';
export interface Agg { col: string; fn: AggFn; as: string; type: ColType }
const AGG_FNS: readonly AggFn[] = ['sum', 'avg', 'min', 'max', 'count', 'count_distinct'];
const AGG_INPUT: Record<AggFn, ColType[] | 'any'> = {
  sum: ['number'], avg: ['number'], min: ['number', 'date', 'timestamp'], max: ['number', 'date', 'timestamp'], count: 'any', count_distinct: 'any',
};
export const AGG_PHRASE: Record<AggFn, string> = {
  sum: 'total of', avg: 'average of', min: 'smallest', max: 'largest', count: 'count of', count_distinct: 'count of distinct',
};

export type Step =
  | {
      kind: 'source'; alias: string; nodeId: string; model: CatalogModel; cols: CatalogColumn[];
      schema: string; table: string; clientColumn: string | null; dateColumn: { name: string; type: ColType } | null;
    }
  | { kind: 'select'; alias: string; nodeId: string; input: string; keep: Col[]; drop: string[] }
  | { kind: 'filter'; alias: string; nodeId: string; input: string; cols: Col[]; cond: Extract<Cond, { kind: 'group' }> | null; ignored: number }
  | { kind: 'group'; alias: string; nodeId: string; input: string; by: Col[]; aggs: Agg[] };

export interface Plan {
  steps: Step[];
  output: { input: string; cols: Col[]; client: string; folder: string; fmt: 'CSV' | 'Parquet' };
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isDate = (s: string) => {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

export const OP_PHRASE: Record<FilterOp, string> = {
  eq: 'equals', ne: 'does not equal', gt: 'is greater than', gte: 'is greater than or equal to', lt: 'is less than', lte: 'is less than or equal to',
  between: 'is between', in: 'is one of', not_in: 'is not one of', contains: 'contains', not_contains: 'does not contain',
  starts_with: 'starts with', ends_with: 'ends with', is_null: 'is blank', is_not_null: 'is not blank',
};

interface RawNode { id: string; type: string; cfg: Record<string, unknown> }
interface RawEdge { from: string; to: string; port: Port }

export function buildPlan(
  graph: unknown, catalog: Catalog, params: CompileParams, opts: Pick<CompileOptions, 'maxNodes'> = {},
): { issues: Issue[]; warnings: string[]; plan: Plan | null } {
  const issues: Issue[] = [];
  const warnings: string[] = [];
  const issue = (code: IssueCode, message: string, nodeId?: string) => issues.push({ code, message, ...(nodeId ? { nodeId } : {}) });
  const fail = () => ({ issues, warnings, plan: null });

  // ---- request parameters ----
  if (typeof params.client !== 'string' || params.client === '') issue('BAD_PARAM', 'A client is required.');
  else if (!params.allowedClients.includes(params.client)) issue('CLIENT_NOT_ALLOWED', 'You cannot run reports for this client.');
  if (params.runDate !== undefined && !isDate(params.runDate)) issue('BAD_PARAM', 'The run date must be a real date written YYYY-MM-DD.');

  // ---- graph shape ----
  if (!isRecord(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    issue('BAD_GRAPH', 'The flow is not in the expected format.');
    return fail();
  }
  const maxNodes = opts.maxNodes ?? DEFAULT_MAX_NODES;
  if (graph.nodes.length > maxNodes) {
    issue('TOO_MANY_NODES', `A flow can have at most ${maxNodes} steps.`);
    return fail();
  }
  const nodes: RawNode[] = [];
  const byId = new Map<string, RawNode>();
  for (const n of graph.nodes) {
    if (!isRecord(n) || typeof n.id !== 'string' || n.id === '' || typeof n.type !== 'string' || (n.cfg !== undefined && !isRecord(n.cfg))) {
      issue('BAD_GRAPH', 'A step is not in the expected format.');
      continue;
    }
    if (byId.has(n.id)) { issue('DUPLICATE_NODE_ID', 'Two steps share the same id.'); continue; }
    if (!(n.type in PORTS)) { issue('UNKNOWN_STEP_TYPE', 'A step has an unknown type.', n.id); continue; }
    const node: RawNode = { id: n.id, type: n.type, cfg: (n.cfg as Record<string, unknown> | undefined) ?? {} };
    nodes.push(node);
    byId.set(node.id, node);
  }
  const edgeAt = new Map<string, RawEdge>();
  for (const e of graph.edges) {
    if (!isRecord(e) || typeof e.from !== 'string' || typeof e.to !== 'string' || typeof e.port !== 'string') {
      issue('BAD_EDGE', 'A connection is not in the expected format.');
      continue;
    }
    const from = byId.get(e.from);
    const to = byId.get(e.to);
    if (!from || !to) { issue('BAD_EDGE', 'A connection points at a step that does not exist.'); continue; }
    if (!(PORTS[to.type] as string[]).includes(e.port)) { issue('BAD_EDGE', 'A connection goes into an input this step does not have.', to.id); continue; }
    if (from.type === 's3') { issue('BAD_EDGE', 'The S3 output cannot feed another step.', from.id); continue; }
    const key = to.id + '\0' + e.port;
    if (edgeAt.has(key)) { issue('BAD_EDGE', 'An input has more than one connection.', to.id); continue; }
    edgeAt.set(key, { from: e.from, to: e.to, port: e.port as Port });
  }
  const outputs = nodes.filter((n) => n.type === 's3');
  if (outputs.length !== 1) issue('OUTPUT_COUNT', 'A flow needs exactly one S3 output step.');
  if (issues.length) return fail();
  const s3 = outputs[0]!;

  // ---- reachable steps in dependency order (post-order walk back from the output) ----
  const order: RawNode[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  let cyclic = false;
  const visit = (n: RawNode) => {
    const st = state.get(n.id);
    if (st === 'done') return;
    if (st === 'visiting') { if (!cyclic) issue('CYCLE', 'The flow contains a loop.', n.id); cyclic = true; return; }
    state.set(n.id, 'visiting');
    for (const p of PORTS[n.type]!) {
      const e = edgeAt.get(n.id + '\0' + p);
      if (!e) { issue('MISSING_INPUT', 'This step is missing an input connection.', n.id); continue; }
      visit(byId.get(e.from)!);
    }
    state.set(n.id, 'done');
    order.push(n);
  };
  visit(s3);
  if (issues.length) return fail();
  const unused = nodes.length - order.length;
  if (unused > 0) warnings.push(`${unused} step${unused === 1 ? ' is' : 's are'} not connected to the output and will be ignored.`);

  // ---- per-step validation and schema resolution ----
  const schemaOf = new Map<string, Col[] | null>();
  const aliasOf = new Map<string, string>();
  const steps: Step[] = [];
  order.forEach((n, i) => aliasOf.set(n.id, 's' + (i + 1)));
  const inputOf = (n: RawNode, p: Port) => edgeAt.get(n.id + '\0' + p)!.from;

  for (const n of order) {
    const alias = aliasOf.get(n.id)!;
    if (!SUPPORTED.has(n.type)) {
      issue('UNSUPPORTED_STEP', `"${n.type}" steps are not available yet.`, n.id);
      schemaOf.set(n.id, null);
      continue;
    }
    const c = n.cfg;

    if (n.type === 'source') {
      const model = typeof c.ds === 'string' ? catalog.models.find((m) => m.name === c.ds) : undefined;
      if (!model) { issue('UNKNOWN_DATASET', 'This source is not a dataset you can use.', n.id); schemaOf.set(n.id, null); continue; }
      const cols = model.columns.filter((x) => x.selectable && !x.client_key && x.name !== model.client_column);
      const parts = model.table.split('.');
      const clientCol = model.reference ? null : model.client_column;
      if (!model.reference && !(clientCol && model.columns.some((x) => x.name === clientCol))) {
        issue('CATALOG_INVALID', `${model.label} has no client column, so it cannot be used safely.`, n.id);
      }
      if (parts.length !== 2 || !cols.length) issue('CATALOG_INVALID', `${model.label} is not set up correctly in the catalog.`, n.id);
      let dateColumn: { name: string; type: ColType } | null = null;
      if (params.runDate !== undefined && model.date_column) {
        const dc = model.columns.find((x) => x.name === model.date_column);
        if (!dc || (dc.type !== 'date' && dc.type !== 'timestamp')) issue('CATALOG_INVALID', `${model.label} has an invalid date column.`, n.id);
        else dateColumn = { name: dc.name, type: dc.type };
      }
      schemaOf.set(n.id, cols.map((x) => ({ name: x.name, type: x.type })));
      if (!issues.length) steps.push({ kind: 'source', alias, nodeId: n.id, model, cols, schema: parts[0]!, table: parts[1]!, clientColumn: clientCol, dateColumn });
      continue;
    }

    if (n.type === 's3') {
      // Output settings are checked even when an upstream step failed, so the requester sees every problem at once.
      if (typeof c.client !== 'string' || c.client !== params.client) issue('BAD_OUTPUT', 'The output step names a different client than this request.', n.id);
      if (typeof c.folder !== 'string' || !OUTPUT_NAME_RE.test(c.folder)) issue('BAD_OUTPUT', 'The folder name must use lowercase letters, digits and underscores.', n.id);
      if (c.fmt !== 'CSV' && c.fmt !== 'Parquet') issue('BAD_OUTPUT', 'Choose CSV or Parquet.', n.id);
    }

    const inId = inputOf(n, 'in');
    const inCols = schemaOf.get(inId);
    const inAlias = aliasOf.get(inId)!;
    if (!inCols) { schemaOf.set(n.id, null); continue; } // upstream already reported

    if (n.type === 'select') {
      const drop = c.drop === undefined ? [] : c.drop;
      const extras = c.extras === undefined ? [] : c.extras;
      if (!Array.isArray(drop) || !drop.every((x) => typeof x === 'string') || !Array.isArray(extras) || !extras.every((x) => typeof x === 'string')) {
        issue('BAD_RULE', 'The column choices on this step are not in the expected format.', n.id); schemaOf.set(n.id, null); continue;
      }
      if (extras.length) {
        issue('NEEDS_DATA_ENG', `Not available yet: ${extras.join(', ')}. This request has to go to data engineering, not approval.`, n.id);
        schemaOf.set(n.id, null); continue;
      }
      const names = new Set(inCols.map((x) => x.name));
      const bad = (drop as string[]).filter((x) => !names.has(x));
      if (bad.length) { issue('UNKNOWN_COLUMN', `Unknown column${bad.length === 1 ? '' : 's'} to hide: ${bad.join(', ')}.`, n.id); schemaOf.set(n.id, null); continue; }
      const keep = inCols.filter((x) => !(drop as string[]).includes(x.name));
      if (!keep.length) { issue('NO_COLUMNS', 'At least one column must be kept.', n.id); schemaOf.set(n.id, null); continue; }
      schemaOf.set(n.id, keep);
      steps.push({ kind: 'select', alias, nodeId: n.id, input: inAlias, keep, drop: [...new Set(drop as string[])] });
      continue;
    }

    if (n.type === 'filter') {
      let ignored = 0;
      let leaves = 0;
      let ok = true;
      const fail1 = (code: IssueCode, msg: string) => { issue(code, msg, n.id); ok = false; };
      const parseGroup = (g: Record<string, unknown>, depth: number, path: string): Extract<Cond, { kind: 'group' }> => {
        const match = g.match === undefined ? 'all' : g.match;
        if (match !== 'all' && match !== 'any') fail1('BAD_RULE', 'Choose "all" or "any" for how the rules combine.');
        const raw = g.rules === undefined ? [] : g.rules;
        const out: Cond[] = [];
        if (!Array.isArray(raw)) { fail1('BAD_RULE', 'The rules on this step are not in the expected format.'); return { kind: 'group', match: 'all', items: out }; }
        raw.forEach((r, idx) => {
          const label = `Rule ${path}${idx + 1}`;
          if (isRecord(r) && Array.isArray(r.rules)) {
            if (depth >= MAX_DEPTH) { fail1('BAD_RULE', `Rule groups can be nested ${MAX_DEPTH} levels deep at most.`); return; }
            const sub = parseGroup(r, depth + 1, `${path}${idx + 1}.`);
            if (sub.items.length) out.push(sub); // a group with nothing effective in it is dropped
            return;
          }
          if (++leaves > MAX_RULES) { if (leaves === MAX_RULES + 1) fail1('BAD_RULE', `A filter can have at most ${MAX_RULES} rules.`); return; }
          if (
            !isRecord(r) || typeof r.col !== 'string' || typeof r.op !== 'string' ||
            (r.val !== undefined && typeof r.val !== 'string') || (r.val2 !== undefined && typeof r.val2 !== 'string') ||
            (r.vals !== undefined && !(Array.isArray(r.vals) && r.vals.every((x) => typeof x === 'string')))
          ) {
            fail1('BAD_RULE', `${label} is not in the expected format.`); return;
          }
          if (!(ALL_OPS as string[]).includes(r.op)) { fail1('BAD_RULE', `${label}: unknown comparison.`); return; }
          const op = r.op as FilterOp;
          const col = inCols.find((x) => x.name === r.col);
          if (!col) { fail1('UNKNOWN_COLUMN', `${label}: "${r.col.slice(0, 60)}" is not a column at this step.`); return; }
          if (!OPS_BY_TYPE[col.type].includes(op)) {
            fail1('TYPE_ERROR', `${label}: "${col.name}" is ${col.type === 'number' ? 'a number' : 'a ' + col.type} column and cannot be compared with "${OP_PHRASE[op]}".`); return;
          }
          const arity = arityOf(op);
          const val = (r.val as string | undefined) ?? '';
          const val2 = (r.val2 as string | undefined) ?? '';
          const list = ((r.vals as string[] | undefined) ?? []).filter((x) => x !== '');
          // SPEC 7: a rule with no value is ignored. Comparisons that need no value are never ignored.
          if ((arity === 'one' && val === '') || (arity === 'list' && list.length === 0) || (arity === 'two' && val === '' && val2 === '')) { ignored++; return; }
          if (arity === 'two' && (val === '' || val2 === '')) { fail1('BAD_RULE', `${label}: "${OP_PHRASE[op]}" needs two values.`); return; }
          if (list.length > MAX_LIST) { fail1('BAD_RULE', `${label}: a list can have at most ${MAX_LIST} values.`); return; }
          const texts = arity === 'none' ? [] : arity === 'one' ? [val] : arity === 'two' ? [val, val2] : list;
          const values: ParamValue[] = [];
          for (const t of texts) {
            if (t.length > MAX_VALUE_LENGTH) { fail1('BAD_RULE', `${label}: a value is too long.`); return; }
            if (col.type === 'number') {
              if (!NUMBER_RE.test(t) || !Number.isFinite(Number(t))) { fail1('TYPE_ERROR', `${label}: "${col.name}" needs a number such as 1000 or 0.25.`); return; }
              values.push(Number(t));
            } else if (col.type === 'date') {
              if (!isDate(t)) { fail1('TYPE_ERROR', `${label}: "${col.name}" needs a date written YYYY-MM-DD.`); return; }
              values.push(t);
            } else if (col.type === 'timestamp') {
              if (!TIMESTAMP_RE.test(t)) { fail1('TYPE_ERROR', `${label}: "${col.name}" needs a date and time such as 2026-10-07 14:30:00.`); return; }
              values.push(t);
            } else if (col.type === 'boolean') {
              const v = t.toLowerCase();
              if (v !== 'true' && v !== 'false') { fail1('TYPE_ERROR', `${label}: "${col.name}" needs true or false.`); return; }
              values.push(v === 'true');
            } else values.push(t);
          }
          out.push({ kind: 'rule', col: col.name, colType: col.type, op, values });
        });
        return { kind: 'group', match: match === 'any' ? 'any' : 'all', items: out };
      };
      const top = parseGroup(c, 1, '');
      schemaOf.set(n.id, ok ? inCols : null);
      if (ok) {
        if (ignored) warnings.push(`${ignored} filter rule${ignored === 1 ? ' has' : 's have'} no value and ${ignored === 1 ? 'is' : 'are'} ignored.`);
        steps.push({ kind: 'filter', alias, nodeId: n.id, input: inAlias, cols: inCols, cond: top.items.length ? top : null, ignored });
      }
      continue;
    }

    if (n.type === 'group') {
      const by = c.by;
      const aggsRaw = c.aggs === undefined ? [] : c.aggs;
      const bad = (msg: string) => { issue('BAD_RULE', msg, n.id); schemaOf.set(n.id, null); };
      if (!Array.isArray(by) || !by.every((x) => typeof x === 'string') || !Array.isArray(aggsRaw)) {
        bad('The grouping on this step is not in the expected format.'); continue;
      }
      if (by.length === 0) { bad('Choose at least one column to group by.'); continue; }
      if (aggsRaw.length > MAX_AGGS) { bad(`A group step can have at most ${MAX_AGGS} totals.`); continue; }
      const byCols: Col[] = [];
      let ok = true;
      for (const name of by as string[]) {
        const col = inCols.find((x) => x.name === name);
        if (!col) { issue('UNKNOWN_COLUMN', `"${name.slice(0, 60)}" is not a column at this step.`, n.id); ok = false; }
        else if (byCols.some((x) => x.name === name)) { issue('BAD_RULE', `"${name}" is listed twice in the group columns.`, n.id); ok = false; }
        else byCols.push(col);
      }
      const aggs: Agg[] = [];
      aggsRaw.forEach((a, idx) => {
        const label = `Total ${idx + 1}`;
        if (!isRecord(a) || typeof a.col !== 'string' || typeof a.fn !== 'string' || (a.as !== undefined && a.as !== '' && typeof a.as !== 'string')) {
          issue('BAD_RULE', `${label} is not in the expected format.`, n.id); ok = false; return;
        }
        const col = inCols.find((x) => x.name === a.col);
        if (!col) { issue('UNKNOWN_COLUMN', `${label}: "${a.col.slice(0, 60)}" is not a column at this step.`, n.id); ok = false; return; }
        if (!(AGG_FNS as readonly string[]).includes(a.fn)) { issue('BAD_RULE', `${label}: unknown calculation.`, n.id); ok = false; return; }
        const fn = a.fn as AggFn;
        const allowed = AGG_INPUT[fn];
        if (allowed !== 'any' && !allowed.includes(col.type)) {
          issue('TYPE_ERROR', `${label}: ${AGG_PHRASE[fn]} needs a ${allowed.join(' or ')} column, but "${col.name}" is ${col.type}.`, n.id); ok = false; return;
        }
        const as = typeof a.as === 'string' && a.as !== '' ? a.as : `${fn}_${col.name}`;
        if (!OUTPUT_NAME_RE.test(as)) { issue('BAD_RULE', `${label}: "${as.slice(0, 60)}" is not a valid column name (lowercase letters, digits and underscores).`, n.id); ok = false; return; }
        const type: ColType = fn === 'min' || fn === 'max' ? col.type : 'number';
        aggs.push({ col: col.name, fn, as, type });
      });
      const names = [...byCols.map((x) => x.name), ...aggs.map((x) => x.as)];
      const dup = names.find((x, i) => names.indexOf(x) !== i);
      if (dup) { issue('BAD_RULE', `Two columns would both be called "${dup}". Rename one of the totals.`, n.id); ok = false; }
      if (!ok) { schemaOf.set(n.id, null); continue; }
      schemaOf.set(n.id, [...byCols, ...aggs.map((x) => ({ name: x.as, type: x.type }))]);
      steps.push({ kind: 'group', alias, nodeId: n.id, input: inAlias, by: byCols, aggs });
      continue;
    }

    // s3
    schemaOf.set(n.id, inCols);
    const seen = new Set<string>();
    for (const col of inCols) {
      if (!OUTPUT_NAME_RE.test(col.name) || seen.has(col.name)) issue('BAD_OUTPUT', `Column "${col.name}" cannot be used as an output column name.`, n.id);
      seen.add(col.name);
    }
  }
  if (issues.length) return fail();

  const outCols = schemaOf.get(s3.id)!;
  return {
    issues, warnings,
    plan: {
      steps,
      output: { input: aliasOf.get(inputOf(s3, 'in'))!, cols: outCols, client: params.client, folder: s3.cfg.folder as string, fmt: s3.cfg.fmt as 'CSV' | 'Parquet' },
    },
  };
}
