import { AGG_PHRASE, arityOf, OP_PHRASE, type Cond, type Plan } from './plan';

const fmtValue = (v: string | number | boolean) => (typeof v === 'string' ? `"${v}"` : String(v));

const describe = (c: Cond, nested: boolean): string => {
  if (c.kind === 'rule') {
    const a = arityOf(c.op);
    const tail = a === 'none' ? '' : a === 'two' ? ` ${fmtValue(c.values[0]!)} and ${fmtValue(c.values[1]!)}` : ` ${c.values.map(fmtValue).join(', ')}`;
    return `${c.col} ${OP_PHRASE[c.op]}${tail}`;
  }
  const text = c.items.map((i) => describe(i, true)).join(c.match === 'all' ? ' and ' : ' or ');
  return nested && c.items.length > 1 ? `(${text})` : text;
};

/** Plain-language list the approver reads before the SQL (SPEC 7). */
export function summarise(plan: Plan): string[] {
  const out: string[] = [];
  for (const s of plan.steps) {
    if (s.kind === 'source') out.push(`Start from ${s.model.label}`);
    else if (s.kind === 'select') out.push(s.drop.length ? `Hide ${s.drop.length === 1 ? 'column' : 'columns'}: ${s.drop.join(', ')}` : 'Keep all columns');
    else if (s.kind === 'filter') out.push(s.cond ? 'Keep rows where ' + describe(s.cond, false) : 'Filter rows (no rules, so every row passes)');
    else {
      const parts = s.aggs.map((a) => `${AGG_PHRASE[a.fn]} ${a.col}`);
      out.push(`Group by ${s.by.map((c) => c.name).join(', ')}` + (parts.length ? ` and work out ${parts.join(', ')}` : ''));
    }
  }
  const o = plan.output;
  out.push(`Write to S3 for ${o.client} as ${o.fmt} in "${o.folder}" (${o.cols.length} column${o.cols.length === 1 ? '' : 's'})`);
  return out;
}
