import { physicalName, quoteIdent } from './identifiers';
import type { Cond, Plan } from './plan';
import type { ParamValue } from './types';

export type PhysicalCase = 'upper' | 'lower' | 'preserve';

/** Collects bind values. In named style the same name is reused; in `?` style every use is a new bind. */
class Binder {
  readonly params: Record<string, ParamValue> = {};
  readonly binds: ParamValue[] = [];
  private n = 0;
  constructor(private readonly style: 'named' | 'qmark') {}
  nextName() { return 'f' + ++this.n; }
  bind(name: string, value: ParamValue): string {
    this.params[name] = value;
    if (this.style === 'qmark') { this.binds.push(value); return '?'; }
    return ':' + name;
  }
}

function condition(r: Extract<Cond, { kind: 'rule' }>, b: Binder): string {
  const col = quoteIdent(r.col);
  const text = r.colType === 'text';
  // Text is compared case-insensitively (SPEC 7). Values are always bound; contains and friends are plain substring
  // functions, so there are no LIKE wildcards to escape.
  const L = text ? `LOWER(${col})` : col;
  const R = (v: ParamValue) => {
    const p = b.bind(b.nextName(), v);
    return text ? `LOWER(${p})` : r.colType === 'date' ? `TO_DATE(${p})` : r.colType === 'timestamp' ? `TO_TIMESTAMP(${p})` : p;
  };
  const v = r.values;
  switch (r.op) {
    case 'eq': return `${L} = ${R(v[0]!)}`;
    case 'ne': return `${L} <> ${R(v[0]!)}`;
    case 'gt': return `${L} > ${R(v[0]!)}`;
    case 'gte': return `${L} >= ${R(v[0]!)}`;
    case 'lt': return `${L} < ${R(v[0]!)}`;
    case 'lte': return `${L} <= ${R(v[0]!)}`;
    case 'between': return `${L} BETWEEN ${R(v[0]!)} AND ${R(v[1]!)}`;
    case 'in': return `${L} IN (${v.map(R).join(', ')})`;
    case 'not_in': return `${L} NOT IN (${v.map(R).join(', ')})`;
    case 'contains': return `CONTAINS(${L}, ${R(v[0]!)})`;
    case 'not_contains': return `NOT CONTAINS(${L}, ${R(v[0]!)})`;
    case 'starts_with': return `STARTSWITH(${L}, ${R(v[0]!)})`;
    case 'ends_with': return `ENDSWITH(${L}, ${R(v[0]!)})`;
    // "blank" for text means empty or missing
    case 'is_null': return text ? `(${col} IS NULL OR ${col} = '')` : `${col} IS NULL`;
    case 'is_not_null': return text ? `(${col} IS NOT NULL AND ${col} <> '')` : `${col} IS NOT NULL`;
  }
}

/** Nested groups are always parenthesised, so AND / OR never regroup by precedence. */
function emitCond(c: Cond, b: Binder): string {
  if (c.kind === 'rule') return condition(c, b);
  const parts = c.items.map((i) => emitCond(i, b));
  return parts.length === 1 ? parts[0]! : '(' + parts.join(c.match === 'all' ? ' AND ' : ' OR ') + ')';
}

const AGG_SQL = {
  sum: (c: string) => `ROUND(SUM(${c}), 2)`, // 2 decimals, as in the prototype
  avg: (c: string) => `ROUND(AVG(${c}), 2)`,
  min: (c: string) => `MIN(${c})`,
  max: (c: string) => `MAX(${c})`,
  count: (c: string) => `COUNT(${c})`, // non-empty values
  count_distinct: (c: string) => `COUNT(DISTINCT ${c})`,
} as const;

export function emit(plan: Plan, client: string, runDate: string | undefined, physical: PhysicalCase, style: 'named' | 'qmark') {
  const b = new Binder(style);
  const ctes: string[] = [];

  for (const s of plan.steps) {
    if (s.kind === 'source') {
      const list = s.cols.map((c) => {
        const phys = physicalName(c.name, physical);
        return phys === c.name ? quoteIdent(c.name) : `${quoteIdent(phys)} AS ${quoteIdent(c.name)}`;
      });
      const lines = [`SELECT ${list.join(', ')}`, `FROM ${quoteIdent(physicalName(s.schema, physical))}.${quoteIdent(physicalName(s.table, physical))}`];
      const where: string[] = [];
      // Client isolation lives here, before any other step (SPEC 7, rule 3).
      if (s.clientColumn) where.push(`${quoteIdent(physicalName(s.clientColumn, physical))} = ${b.bind('client', client)}`);
      if (s.dateColumn && runDate !== undefined) {
        const dc = quoteIdent(physicalName(s.dateColumn.name, physical));
        where.push(`${s.dateColumn.type === 'timestamp' ? `CAST(${dc} AS DATE)` : dc} = TO_DATE(${b.bind('run_date', runDate)})`);
      }
      if (where.length) lines.push(`WHERE ${where.join('\n      AND ')}`);
      ctes.push(`  ${s.alias} AS (\n    ${lines.join('\n    ')}\n  )`);
    } else if (s.kind === 'select') {
      ctes.push(`  ${s.alias} AS (\n    SELECT ${s.keep.map((c) => quoteIdent(c.name)).join(', ')}\n    FROM ${s.input}\n  )`);
    } else if (s.kind === 'filter') {
      const lines = ['SELECT *', `FROM ${s.input}`];
      if (s.cond) {
        const parts = s.cond.items.map((i) => emitCond(i, b));
        lines.push(`WHERE ${parts.join(s.cond.match === 'all' ? '\n      AND ' : '\n      OR ')}`);
      }
      ctes.push(`  ${s.alias} AS (\n    ${lines.join('\n    ')}\n  )`);
    } else {
      const sel = [
        ...s.by.map((c) => quoteIdent(c.name)),
        ...s.aggs.map((a) => `${AGG_SQL[a.fn](quoteIdent(a.col))} AS ${quoteIdent(a.as)}`),
      ];
      ctes.push(`  ${s.alias} AS (\n    SELECT ${sel.join(', ')}\n    FROM ${s.input}\n    GROUP BY ${s.by.map((c) => quoteIdent(c.name)).join(', ')}\n  )`);
    }
  }

  const sql = `WITH\n${ctes.join(',\n')}\nSELECT ${plan.output.cols.map((c) => quoteIdent(c.name)).join(', ')}\nFROM ${plan.output.input}`;
  return { sql, params: b.params, binds: b.binds };
}
