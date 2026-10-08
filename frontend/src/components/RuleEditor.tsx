import { arityOf, OPS_BY_TYPE, OP_PHRASE } from '../../../packages/compiler/src';
import { isGroup, type ColType, type FilterOp, type Rule, type RuleGroup, type RuleItem } from '../lib/types';
import { ChipsInput } from './ChipsInput';

const MAX_DEPTH = 3;

interface Props {
  value: RuleGroup;
  onChange: (next: RuleGroup) => void;
  cols: string[];
  /** type of each column in `cols`; decides which comparisons are offered */
  types: ColType[];
  /** column used for a newly added rule */
  defaultCol: string;
  depth?: number;
  onRemove?: () => void;
}

/** Rules combined with "all" (AND) or "any" (OR). A rule can itself be a group, up to MAX_DEPTH levels. */
/** A new rule starts with a comparison that suits its column. */
const newRule = (col: string, type: ColType | undefined): Rule => ({ col, op: type === 'number' || type === 'date' || type === 'timestamp' ? 'gt' : 'eq', val: '' });

export function RuleEditor({ value, onChange, cols, types, defaultCol, depth = 1, onRemove }: Props) {
  const typeOf = (c: string): ColType | undefined => types[cols.indexOf(c)];
  const set = (rules: RuleItem[]) => onChange({ ...value, rules });
  const replace = (i: number, item: RuleItem) => set(value.rules.map((x, j) => (j === i ? item : x)));
  const word = value.match === 'all' ? 'and' : 'or';

  return (
    <div className={'rule-group' + (depth > 1 ? ' nested' : '')}>
      <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <label className="row" style={{ alignItems: 'center', gap: 6 }}>
          <span>Match</span>
          <select className="field inline" aria-label="How the rules combine" value={value.match} onChange={(e) => onChange({ ...value, match: e.target.value as 'all' | 'any' })}>
            <option value="all">all</option>
            <option value="any">any</option>
          </select>
          <span style={{ whiteSpace: 'nowrap' }}>of these</span>
        </label>
        {onRemove && <button className="btn sm" onClick={onRemove}>Remove group</button>}
      </div>

      {value.rules.length === 0 && <div className="empty">{depth > 1 ? 'No rules in this group yet.' : 'No rules yet. Every row passes through.'}</div>}
      {value.rules.map((item, i) => (
        <div key={i} className="stack-sm">
          {i > 0 && <div className="joiner">{word}</div>}
          {isGroup(item) ? (
            <RuleEditor value={item} onChange={(g) => replace(i, g)} onRemove={() => set(value.rules.filter((_, j) => j !== i))} cols={cols} types={types} defaultCol={defaultCol} depth={depth + 1} />
          ) : (
            <RuleRow item={item} cols={cols} ops={OPS_BY_TYPE[typeOf(item.col) ?? 'text']} onChange={(r) => replace(i, r)} onRemove={() => set(value.rules.filter((_, j) => j !== i))}
              onColumn={(col) => {
                const ok = OPS_BY_TYPE[typeOf(col) ?? 'text'].includes(item.op);
                replace(i, { ...item, col, op: ok ? item.op : newRule(col, typeOf(col)).op });
              }} />
          )}
        </div>
      ))}

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button className="btn dark" onClick={() => set(value.rules.concat(newRule(defaultCol, typeOf(defaultCol))))}>Add a rule</button>
        {depth < MAX_DEPTH && <button className="btn sm" onClick={() => set(value.rules.concat({ match: value.match === 'all' ? 'any' : 'all', rules: [] }))}>Add a group</button>}
      </div>
    </div>
  );
}

function RuleRow({ item, cols, ops, onChange, onColumn, onRemove }: {
  item: Rule; cols: string[]; ops: FilterOp[]; onChange: (r: Rule) => void; onColumn: (col: string) => void; onRemove: () => void;
}) {
  const kind = arityOf(item.op);
  return (
    <div className="rule">
      <select className="field" aria-label="Column" value={item.col} onChange={(e) => onColumn(e.target.value)}>
        {cols.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      <select className="field" aria-label="Comparison" value={item.op} onChange={(e) => onChange({ ...item, op: e.target.value as FilterOp })}>
        {ops.map((k) => <option key={k} value={k}>{OP_PHRASE[k]}</option>)}
      </select>
      {kind === 'one' && <input className="field" aria-label="Value" value={item.val} placeholder="Value" onChange={(e) => onChange({ ...item, val: e.target.value })} />}
      {kind === 'two' && (
        <div className="row" style={{ alignItems: 'center' }}>
          <input className="field" aria-label="Value" value={item.val} placeholder="From" onChange={(e) => onChange({ ...item, val: e.target.value })} />
          <span className="small muted">and</span>
          <input className="field" aria-label="Second value" value={item.val2 ?? ''} placeholder="To" onChange={(e) => onChange({ ...item, val2: e.target.value })} />
        </div>
      )}
      {kind === 'list' && <ChipsInput label="Value" values={item.vals ?? []} onChange={(vals) => onChange({ ...item, vals })} />}
      <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={onRemove}>Remove</button>
    </div>
  );
}
