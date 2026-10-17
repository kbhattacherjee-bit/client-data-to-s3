import type { AggFn, AggSpec, ColType } from '../lib/types';
import { Select } from './Select';

const FN_LABEL: Record<AggFn, string> = { sum: 'Sum', avg: 'Average', min: 'Smallest', max: 'Largest', count: 'Count', count_distinct: 'Count distinct' };
const ALL_FNS = Object.keys(FN_LABEL) as AggFn[];

/** Which functions make sense for a column type (the compiler enforces the same rules). */
export const fnsFor = (t: ColType | undefined): AggFn[] =>
  t === 'number' ? ALL_FNS : t === 'date' || t === 'timestamp' ? ['min', 'max', 'count', 'count_distinct'] : ['count', 'count_distinct'];

interface Props {
  by: string[];
  aggs: AggSpec[];
  cols: string[];
  types: ColType[];
  onChange: (next: { by: string[]; aggs: AggSpec[] }) => void;
}

export function GroupEditor({ by, aggs, cols, types, onChange }: Props) {
  const typeOf = (c: string) => types[cols.indexOf(c)];
  const setAgg = (i: number, patch: Partial<AggSpec>) => onChange({ by, aggs: aggs.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  /** A new total defaults to a column and function not used yet, so two totals never share a name. */
  const addAgg = () => {
    const used = new Set(aggs.map((a) => `${a.col}:${a.fn}`));
    const pool = [...cols.filter((c) => typeOf(c) === 'number' && !by.includes(c)), ...cols.filter((c) => typeOf(c) !== 'number' || by.includes(c))];
    for (const col of pool) {
      const fn = fnsFor(typeOf(col)).find((f) => !used.has(`${col}:${f}`));
      if (fn) return onChange({ by, aggs: aggs.concat({ col, fn }) });
    }
  };

  return (
    <div className="stack">
      <div>
        <div className="label" style={{ marginBottom: 8 }}>Group rows by</div>
        <div className="chips">
          {cols.map((c) => {
            const on = by.includes(c);
            return <button key={c} className={'toggle' + (on ? ' on' : '')} aria-pressed={on} onClick={() => onChange({ by: on ? by.filter((x) => x !== c) : by.concat(c), aggs })}>{c}</button>;
          })}
        </div>
        <div className="small muted" style={{ marginTop: 6 }}>One output row for each combination of the chosen columns.</div>
      </div>

      <div>
        <div className="label">Totals</div>
        <div className="small muted" style={{ marginBottom: 8 }}>Each total becomes one column. Leave the name blank to use, for example, sum_commission.</div>
        <div className="stack-sm">
          {aggs.map((a, i) => {
            const fns = fnsFor(typeOf(a.col));
            return (
              <div key={i} className="rule">
                <Select label="Column" value={a.col} options={cols.map((c) => ({ value: c, label: c }))} onChange={(col) => {
                  const fn = fnsFor(typeOf(col)).includes(a.fn) ? a.fn : fnsFor(typeOf(col))[0]!;
                  setAgg(i, { col, fn });
                }} />
                <Select label="Calculation" value={a.fn} options={fns.map((f) => ({ value: f, label: FN_LABEL[f] }))} onChange={(fn) => setAgg(i, { fn: fn as AggFn })} />
                <div className="row">
                  <input className="field mono" style={{ flex: 1, minWidth: 0 }} aria-label="Column name" value={a.as ?? ''} placeholder={`${a.fn}_${a.col}`} onChange={(e) => setAgg(i, { as: e.target.value.toLowerCase().replace(/\s+/g, '_') })} />
                  <button className="btn sm" onClick={() => onChange({ by, aggs: aggs.filter((_, j) => j !== i) })}>Remove</button>
                </div>
              </div>
            );
          })}
        </div>
        <button className="btn dark" style={{ marginTop: 10 }} onClick={addAgg}>Add a total</button>
      </div>
    </div>
  );
}
