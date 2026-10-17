import { useState } from 'react';
import { clients, datasets, restricted, s3Path } from '../lib/catalog';
import { inputOf } from '../lib/panel';
import type { AppState } from '../lib/useApp';
import type { ArithOp, NodeType } from '../lib/types';
import { DataTable } from './DataTable';
import { Icon } from './Icon';
import { GroupEditor } from './GroupEditor';
import { RuleEditor } from './RuleEditor';
import { SqlPanel } from './SqlPanel';

const NAMES: Record<NodeType, string> = { source: 'Source', select: 'Select columns', filter: 'Filter rows', group: 'Group by', addcol: 'Add columns', join: 'Join', union: 'Union', s3: 'Amazon S3' };
const HELPS: Record<NodeType, string> = {
  source: 'A dataset you can access. Pick which one.',
  select: 'Hide columns you do not want the client to see.',
  filter: 'Keep only rows that match all of the rules, or any of them. Groups let you mix the two.',
  group: 'Collapse rows into one line per combination of values, with the totals you choose.',
  addcol: 'Create a column from a calculation.',
  join: 'Combine two datasets by matching a shared column.',
  union: 'Stack the rows of two datasets.',
  s3: 'Where finished files are placed.',
};
const ARITH: [ArithOp, string][] = [['+', '+'], ['-', '−'], ['*', '×'], ['/', '÷']];

function Choice({ on, onClick, children, center }: { on: boolean; onClick: () => void; children: React.ReactNode; center?: boolean }) {
  return (
    <button type="button" className={'choice' + (on ? ' sel' : '') + (center ? ' center' : '')} aria-pressed={on} onClick={onClick}>
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

export type PanelTab = 'step' | 'sql';

export function StepPanel({ app, tab, setTab }: { app: AppState; tab: PanelTab; setTab: (t: PanelTab) => void }) {
  const { graph, T, selected, patchCfg, showToast } = app;
  const [draft, setDraft] = useState('');
  const picked = graph.nodes.find((n) => n.id === selected);
  const node = picked ?? graph.nodes.find((n) => n.type === 's3')!;
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

  const stepIssues = app.sql.ok ? [] : app.sql.issues.filter((i) => i.nodeId === node.id);

  const steps = graph.nodes.filter((n) => n.type !== 's3' && n.type !== 'source').length;
  const sources = graph.nodes.filter((n) => n.type === 'source').length;

  const body = tab === 'sql' ? (
    <SqlPanel outcome={app.sql} hint />
  ) : !picked ? (
    <>
      <div>
        <div className="panel-kicker">{graph.nodes.length === 1 ? 'Getting started' : 'Nothing selected'}</div>
        <h2 className="t-panel" style={{ marginTop: 2 }}>{graph.nodes.length === 1 ? 'Build your report' : 'Select a step to edit it'}</h2>
        <p className="muted" style={{ marginTop: 6 }}>
          {graph.nodes.length === 1 ? 'Shape a governed dataset, check the result, then send it for approval.' : `${sources} source${sources === 1 ? '' : 's'} and ${steps} step${steps === 1 ? '' : 's'} so far. Click any card on the canvas to change its settings.`}
        </p>
      </div>
      <ol className="hint-list">
        <li><span className="hint-n">1</span><div><div className="label" style={{ marginBottom: 0 }}>Choose a source</div><div className="small muted">Pick the dataset the report starts from.</div></div></li>
        <li><span className="hint-n">2</span><div><div className="label" style={{ marginBottom: 0 }}>Shape the data</div><div className="small muted">Add steps to hide columns, filter rows, group or join.</div></div></li>
        <li><span className="hint-n">3</span><div><div className="label" style={{ marginBottom: 0 }}>Review and submit</div><div className="small muted">Check the preview and the SQL, then send it for approval.</div></div></li>
      </ol>
    </>
  ) : (
    <>
      {stepIssues.length > 0 && <div className="issue-box"><Icon name="sparkle" size={16} /><div>{stepIssues.map((i, k) => <div key={k}>{i.message}</div>)}</div></div>}
      <div>
        <div className="panel-kicker">{node.type === 'source' ? 'Source' : node.type === 's3' ? 'Output' : 'Step'}</div>
        <h2 className="t-panel" style={{ marginTop: 2 }}>{sourceDs ? sourceDs.name : NAMES[node.type]}</h2>
        <p className="muted" style={{ marginTop: 4 }}>{HELPS[node.type]}</p>
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
        <RuleEditor
          value={{ match: c.match ?? 'all', rules: c.rules ?? [] }}
          onChange={(g) => patchCfg(id, { match: g.match, rules: g.rules })}
          cols={inCols}
          types={inTable?.types ?? []}
          defaultCol={numCol}
        />
      )}

      {node.type === 'group' && (
        <GroupEditor by={c.by ?? []} aggs={c.aggs ?? []} cols={inCols} types={inTable?.types ?? []} onChange={(g) => patchCfg(id, g)} />
      )}

      {node.type === 'addcol' && (
        <div className="stack" style={{ gap: 10 }}>
          <div className="label" style={{ margin: 0 }}>New column name</div>
          <input className="field mono" value={c.name ?? ''} onChange={(e) => patchCfg(id, { name: e.target.value.toLowerCase().replace(/\s+/g, '_') })} />
          <div className="label" style={{ margin: 0 }}>Calculate</div>
          <ColSelect value={c.a ?? ''} cols={inCols} blank="Choose a column" onChange={(a) => patchCfg(id, { a })} />
          <div className="choices-row" style={{ gap: 6 }}>
            {ARITH.map(([k, glyph]) => <Choice key={k} center on={c.op === k} onClick={() => patchCfg(id, { op: k })}>{glyph}</Choice>)}
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
                  <Choice key={k} on={c.type === k} onClick={() => patchCfg(id, { type: k })}>
                    <div style={{ fontWeight: 500 }}>{name}</div>
                    <div className="small faint" style={{ marginTop: 2, fontWeight: 400 }}>{meta}</div>
                  </Choice>
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
              {Object.entries(clients).map(([k, cl]) => <Choice key={k} on={c.client === k} onClick={() => patchCfg(id, { client: k })}>{cl.name}</Choice>)}
            </div>
          </div>
          <div>
            <div className="label">Folder name</div>
            <input className="field mono" value={c.folder ?? ''} placeholder="e.g. commissions_reports" onChange={(e) => patchCfg(id, { folder: e.target.value.replace(/[^a-z0-9_]/gi, '_').toLowerCase() })} />
          </div>
          <div>
            <div className="label" style={{ marginBottom: 8 }}>File type</div>
            <div className="choices-row">
              {(['CSV', 'Parquet'] as const).map((k) => <Choice key={k} center on={c.fmt === k} onClick={() => patchCfg(id, { fmt: k })}>{k}</Choice>)}
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
      {node.type !== 's3' && <button className="btn danger" style={{ alignSelf: 'flex-start' }} onClick={() => app.delNode()}>Delete this step</button>}
    </>
  );

  return (
    <aside className="panel" aria-label="Details">
      <div className="panel-head">
        <div className="segmented" role="tablist" data-tab={tab}>
          <button role="tab" className="seg" aria-selected={tab === 'step'} onClick={() => setTab('step')}>Step</button>
          <button role="tab" className="seg" aria-selected={tab === 'sql'} onClick={() => setTab('sql')}>SQL</button>
        </div>
      </div>
      {/* keyed so each tab or step change plays the same short entrance */}
      <div className="panel-body" key={tab + ':' + (picked?.id ?? '')}>{body}</div>
    </aside>
  );
}
