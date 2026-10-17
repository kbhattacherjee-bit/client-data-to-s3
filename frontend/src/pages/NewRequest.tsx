import { Canvas } from '../components/Canvas';
import { DataTable } from '../components/DataTable';
import { Icon } from '../components/Icon';
import { Modal, type Origin } from '../components/Modal';
import { Palette } from '../components/Palette';
import { StepPanel, type PanelTab } from '../components/StepPanel';
import { datasets, s3Path } from '../lib/catalog';
import type { AppState } from '../lib/useApp';
import { useState } from 'react';

export interface PreviewState { open: boolean; origin: Origin | null }

export function NewRequest({ app, preview, closePreview }: { app: AppState; preview: PreviewState; closePreview: () => void }) {
  const { st, zoom, graph, sql } = app;
  const [tab, setTab] = useState<PanelTab>('step');
  const s3 = graph.nodes.find((n) => n.type === 's3')!;
  const fin = st.final;
  const blank = graph.nodes.length === 1;

  // One calm line about the flow: what to do next, or what is wrong. Nothing alarming until something actually is.
  let tone: 'idle' | 'ok' | 'warn', text: string, detail: string | null = null;
  if (blank) { tone = 'idle'; text = 'Choose a source to begin.'; }
  else if (st.extras.length) { tone = 'warn'; text = `Not available yet: ${st.extras.join(', ')}. Submitting sends a request to the data team to build it.`; }
  else if (st.miss) { tone = 'warn'; text = 'Some steps are not connected yet.'; detail = 'Drag from the dot on the right of a card to the dot on the left of another.'; }
  else { tone = 'ok'; text = 'Every column exists today, so no engineering is needed.'; }
  if (!blank && !st.miss) detail = sql.ok ? `SQL is ready · ${sql.result.outputColumns.length} columns` : sql.issues[0]?.message ?? null;

  return (
    <div className="builder">
      <div className="stage">
        <Canvas app={app} />

        {blank && (
          <div className="empty">
            <div className="empty-card">
              <h2>Start with a source</h2>
              <p>Pick the dataset your report is built from. You can also drag one from the top bar onto the canvas.</p>
              <div className="chips">
                {Object.values(datasets).map((d) => (
                  <button key={d.key} className="chip source" onClick={() => app.addFn('source', d.key)}><Icon name="database" size={14} />{d.name}</button>
                ))}
              </div>
            </div>
          </div>
        )}

        <Palette app={app} />

        <div className="float-row">
        <div className={'float float-status ' + tone} role="status">
          <span className="ico"><Icon name={tone === 'ok' ? 'approve' : tone === 'warn' ? 'alert' : 'sparkle'} size={18} /></span>
          <div>
            <div>{text}</div>
            {detail && (
              <div className="line2">
                {detail}{sql.ok && !st.miss && <> · <button className="link" onClick={() => setTab('sql')}>View SQL</button></>}
              </div>
            )}
          </div>
        </div>

        <div className="float float-view" role="toolbar" aria-label="View">
          <button className="btn ghost icon" title="Zoom out (Ctrl and minus)" aria-label="Zoom out" onClick={() => app.zoomBy(-0.1)}><Icon name="minus" size={16} /></button>
          <button className="btn ghost sm zoom-label" title="Reset zoom (Ctrl and 0)" onClick={() => app.zoomTo(1)}>{Math.round(zoom * 100)}%</button>
          <button className="btn ghost icon" title="Zoom in (Ctrl and plus)" aria-label="Zoom in" onClick={() => app.zoomBy(0.1)}><Icon name="plus" size={16} /></button>
          <span className="sep" />
          <button className="btn ghost sm" title="Arrange the steps neatly" onClick={app.tidy}><Icon name="grid" size={15} />Tidy up</button>
          <button className="btn ghost sm" title="Clear the canvas and begin again" onClick={app.resetFlow}><Icon name="reset" size={15} />Start over</button>
        </div>
        </div>

        <Modal open={preview.open} onClose={closePreview} origin={preview.origin} title="Preview">
          <p className="muted" style={{ marginBottom: 14 }}>
            What the client receives on each run. {fin.rows.length} rows, {fin.cols.length} columns.{st.extras.length ? ' Missing columns are not included.' : ''}
          </p>
          <DataTable table={fin} limit={8} />
          <div className="mono faint" style={{ marginTop: 14, wordBreak: 'break-all' }}>{s3Path(s3.cfg.client!, s3.cfg.folder!)}</div>
        </Modal>
      </div>
      <StepPanel app={app} tab={tab} setTab={setTab} />
    </div>
  );
}
