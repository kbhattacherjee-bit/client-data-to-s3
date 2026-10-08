import { useState } from 'react';
import { clients, datasets, restricted, s3Path } from '../lib/catalog';
import { inputOf } from '../lib/panel';
import type { AppState } from '../lib/useApp';
import type { Agg, ArithOp, FilterOp, NodeType } from '../lib/types';
import { DataTable } from './DataTable';

const NAMES: Record<NodeType, string> = { source: 'Source', select: 'Select columns', filter: 'Filter rows', group: 'Group by', addcol: 'Add columns', join: 'Join', union: 'Union', s3: 'Amazon S3' };
const HELPS: Record<NodeType, string> = {
  source: 'A dataset you can access. Pick which one.',
  select: 'Hide columns you do not want the client to see.',
  filter: 'Keep only rows that match every rule.',
  group: 'Collapse rows into one line per value, with totals.',
  addcol: 'Create a column from a calculation.',
  join: 'Combine two datasets by matching a shared column.',
  union: 'Stack the rows of two datasets.',
  s3: 'Where finished files are placed.',
};
const OPS: Record<FilterOp, string> = { gt: 'is greater than', lt: 'is less than', eq: 'equals', ne: 'does not equal', contains: 'contains' };
const ARITH: [ArithOp, string][] = [['+', '+'], ['-', '−'], ['*', '×'], ['/', '÷']];

function Card({ on, onClick, children, left }: { on: boolean; onClick: () => void; children: React.ReactNode; left?: boolean }) {
  return (
    <button type="button" className={'card' + (on ? ' sel' : '') + (left ? ' left' : '')} aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  );
}

function ColSelect({ value, cols, blank, onChange }: { value: string; cols: string[]; blank?: string; onChange: (v: string) => void }) {
  return (
    <select className="field" value={value} onChange={(e) => onChange(e.target.value)}>
      {blank !== undefined && <option value="">{blank}</option>}
      {cols.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

export function StepPanel({ app }: { app: AppState }) {
  const { graph, T, selected, patchCfg, showToast } = app;
  const [draft, setDraft] = useState('');
  const node = graph.nodes.find((n) => n.id === selected) ?? graph.nodes.find((n) => n.type === 's3')!;
  const c = node.cfg;
  const t = T[node.id];
  const id = node.id;
  const { inCols, inTable, A, B } = inputOf(graph, T, node);
  const common = A && B ? A.cols.filter((x) => B.cols.includes(x)) : [];

  const addField = () => {
    const v = draft.trim().toLowerCase().replace(/\s+/g, '_');
    if (!v) return;
    if (inCols.includes(v)) { patchCfg(id, (cc) => ({ drop: cc.drop!.filter((x) => x !== v) })); setDraft(''); return; }
    if (restricted.has(v)) return showToast(`"${v}" is restricted and cannot be included in client reports.`);
    const other = Object.values(datasets).filter((d) => d.cols.includes(v));
    if (other.length) return showToast(`"${v}" already exists in ${other.map((d) => d.name).join(', ')}. Join that dataset to use it.`);
    patchCfg(id, (cc) => ({ extras: cc.extras!.includes(v) ? cc.extras : cc.extras!.concat(v) }));
    setDraft('');
  };

  const numCol = inCols.find((x) => inTable && inTable.rows.length && typeof inTable.rows[0][inCols.indexOf(x)] === 'number') ?? inCols[0] ?? '';
  const sourceDs = node.type === 'source' ? datasets[c.ds!] : null;
  const s3node = graph.nodes.find((n) => n.type === 's3')!;

  return (
    <div className="panel">
      <div>
        <div className="kicker">{NAMES[node.type]}</div>
        <div className="panel-title">{sourceDs ? sourceDs.name : NAMES[node.type]}</div>
        <div className="muted" style={{ marginTop: 4 }}>{HELPS[node.type]}</div>
      </div>

      {sourceDs && (
        <div className="stack">
          <div className="muted">{sourceDs.desc}</div>
          <div className="mono" style={{ color: 'var(--ink-3)' }}>{sourceDs.table}</div>
          <div>
            <div className="label">Columns</div>
            {sourceDs.cols.map((name, i) => (
              <div key={name} className="col-row">
                <div>
                  <div className="mono">{name}</div>
                  <div style={{ color: 'var(--ink-3)', marginTop: 1, lineHeight: 1.35 }}>{sourceDs.descs[i]}</div>
                </div>
                <span style={{ color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>{sourceDs.types[i]}</span>
              </div>
            ))}
          </div>
          <div className="small" style={{ color: 'var(--ink-3)', lineHeight: 1.45 }}>
            {sourceDs.hidden.length > 0 && `${sourceDs.hidden.length} more column${sourceDs.hidden.length === 1 ? ' is' : 's are'} restricted and not available in client reports. `}
            To use a different dataset, add it from the Sources row and delete this one.
          </div>
        </div>
      )}

      {node.type === 'select' && (
        <div className="stack" style={{ gap: 14 }}>
          <div>
            <div className="label" style={{ marginBottom: 8 }}>Columns to keep</div>
            <div className="chips">
              {inCols.map((x) => {
                const on = !c.drop!.includes(x);
                return (
                  <button key={x} className={'toggle' + (on ? ' on' : '')} aria-pressed={on} onClick={() => patchCfg(id, (cc) => ({ drop: cc.drop!.includes(x) ? cc.drop!.filter((y) => y !== x) : cc.drop!.concat(x) }))}>
                    {x}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <div className="label">A column that is not listed?</div>
            <div className="small muted" style={{ marginBottom: 8 }}>Add it by name. We check whether it exists.</div>
            <div className="row">
              <input className="field mono" style={{ flex: 1, minWidth: 0 }} value={draft} placeholder="e.g. realized_pnl" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addField()} />
              <button className="btn sm" onClick={addField}>Add</button>
            </div>
            <div className="chips" style={{ marginTop: 10 }}>
              {c.extras!.map((x) => (
                <button key={x} className="toggle extra" onClick={() => patchCfg(id, (cc) => ({ extras: cc.extras!.filter((y) => y !== x) }))}>{x} · remove</button>
              ))}
            </div>
          </div>
        </div>
      )}

      {node.type === 'filter' && (
        <div className="stack" style={{ gap: 10 }}>
          {c.rules!.length === 0 && <div className="empty">No rules yet. Every row passes through.</div>}
          {c.rules!.map((r, i) => {
            const up = (patch: Partial<typeof r>) => patchCfg(id, (cc) => ({ rules: cc.rules!.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
            return (
              <div key={i} className="rule">
                <ColSelect value={r.col} cols={inCols} onChange={(col) => up({ col })} />
                <select className="field" value={r.op} onChange={(e) => up({ op: e.target.value as FilterOp })}>
                  {(Object.keys(OPS) as FilterOp[]).map((k) => <option key={k} value={k}>{OPS[k]}</option>)}
                </select>
                <div className="row">
                  <input className="field" style={{ flex: 1, minWidth: 0 }} value={r.val} placeholder="Value" onChange={(e) => up({ val: e.target.value })} />
                  <button className="btn sm" onClick={() => patchCfg(id, (cc) => ({ rules: cc.rules!.filter((_, j) => j !== i) }))}>Remove</button>
                </div>
              </div>
            );
          })}
          <button className="btn dark" onClick={() => patchCfg(id, (cc) => ({ rules: cc.rules!.concat({ col: numCol, op: 'gt', val: '' }) }))}>Add a rule</button>
        </div>
      )}

      {node.type === 'group' && (
        <div className="stack">
          <div className="label" style={{ margin: 0 }}>Group rows by</div>
          <ColSelect value={c.by ?? ''} cols={inCols} blank="Choose a column" onChange={(by) => patchCfg(id, { by })} />
          <div className="label" style={{ margin: 0 }}>Combine numbers by</div>
          <div className="cards-row">
            {([['sum', 'Sum'], ['avg', 'Average'], ['max', 'Max']] as [Agg, string][]).map(([k, name]) => (
              <Card key={k} on={c.agg === k} onClick={() => patchCfg(id, { agg: k })}>{name}</Card>
            ))}
          </div>
          <div className="muted">Each number column becomes one total per group. A row_count column is included.</div>
        </div>
      )}

      {node.type === 'addcol' && (
        <div className="stack" style={{ gap: 10 }}>
          <div className="label" style={{ margin: 0 }}>New column name</div>
          <input className="field mono" value={c.name ?? ''} onChange={(e) => patchCfg(id, { name: e.target.value.toLowerCase().replace(/\s+/g, '_') })} />
          <div className="label" style={{ margin: 0 }}>Calculate</div>
          <ColSelect value={c.a ?? ''} cols={inCols} blank="Choose a column" onChange={(a) => patchCfg(id, { a })} />
          <div className="cards-row" style={{ gap: 6 }}>
            {ARITH.map(([k, glyph]) => <Card key={k} on={c.op === k} onClick={() => patchCfg(id, { op: k })}>{glyph}</Card>)}
          </div>
          <ColSelect value={c.b ?? ''} cols={inCols} blank="A fixed number" onChange={(b) => patchCfg(id, { b })} />
          <input className="field" style={{ opacity: c.b ? 0.4 : 1 }} value={c.num ?? ''} placeholder="Number, e.g. 0.25" onChange={(e) => patchCfg(id, { num: e.target.value })} />
        </div>
      )}

      {(node.type === 'join' || node.type === 'union') && (
        <div className="stack">
          <div className="muted">
            {A ? `First input: ${A.rows.length} rows. ` : 'First input not connected. '}
            {B ? `Second input: ${B.rows.length} rows.` : 'Second input not connected.'}
          </div>
          {node.type === 'join' ? (
            <>
              <div className="label" style={{ margin: 0 }}>Match rows on</div>
              <ColSelect value={c.key ?? ''} cols={common} blank="Choose a shared column" onChange={(key) => patchCfg(id, { key })} />
              <div className="stack-sm">
                {([['inner', 'Matching rows only', 'Drops rows with no match'], ['left', 'Keep all rows from the first input', 'Blank where nothing matches']] as const).map(([k, name, meta]) => (
                  <Card key={k} left on={c.type === k} onClick={() => patchCfg(id, { type: k })}>
                    <div style={{ fontWeight: 500 }}>{name}</div>
                    <div className="small muted" style={{ marginTop: 2 }}>{meta}</div>
                  </Card>
                ))}
              </div>
            </>
          ) : (
            <div className="muted">Rows from both inputs are stacked. Columns are matched by name. A column missing from one input is left blank for its rows.</div>
          )}
        </div>
      )}

      {node.type === 's3' && (
        <div className="stack" style={{ gap: 14 }}>
          <div>
            <div className="label" style={{ marginBottom: 8 }}>Client</div>
            <div className="stack-sm">
              {Object.entries(clients).map(([k, cl]) => <Card key={k} left on={c.client === k} onClick={() => patchCfg(id, { client: k })}><span style={{ fontWeight: 500 }}>{cl.name}</span></Card>)}
            </div>
          </div>
          <div>
            <div className="label">Folder name</div>
            <input className="field mono" value={c.folder ?? ''} onChange={(e) => patchCfg(id, { folder: e.target.value.replace(/[^a-z0-9_]/gi, '_').toLowerCase() })} />
          </div>
          <div>
            <div className="label" style={{ marginBottom: 8 }}>File type</div>
            <div className="cards-row">
              {(['CSV', 'Parquet'] as const).map((k) => <Card key={k} on={c.fmt === k} onClick={() => patchCfg(id, { fmt: k })}>{k}</Card>)}
            </div>
          </div>
          <div>
            <div className="small" style={{ color: 'var(--ink-3)', marginBottom: 4 }}>Files land here</div>
            <div className="path-box">{s3Path(s3node.cfg.client!, s3node.cfg.folder!)}</div>
          </div>
        </div>
      )}

      <div className="result">
        <div className="label">Result of this step</div>
        <div className="small muted" style={{ marginBottom: 8 }}>
          {t.err ?? (t.warn ? t.warn + '. Showing input unchanged.' : `${t.rows.length} rows, ${t.cols.length} columns`)}
        </div>
        <DataTable table={t} limit={4} mini />
      </div>
      {node.type !== 's3' && <button className="btn danger" onClick={() => app.delNode()}>Delete this step</button>}
    </div>
  );
}
