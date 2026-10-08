import { Canvas } from '../components/Canvas';
import { DataTable } from '../components/DataTable';
import { Palette } from '../components/Palette';
import { StepPanel, type PanelTab } from '../components/StepPanel';
import { useState } from 'react';
import { s3Path } from '../lib/catalog';
import type { AppState } from '../lib/useApp';

export function NewRequest({ app, previewOpen, setPreviewOpen }: { app: AppState; previewOpen: boolean; setPreviewOpen: (v: boolean) => void }) {
  const { st, zoom, graph, sql } = app;
  const [tab, setTab] = useState<PanelTab>('step');
  const s3 = graph.nodes.find((n) => n.type === 's3')!;
  const fin = st.final;

  let tone: 'ok' | 'warn', text: string;
  if (st.extras.length) { tone = 'warn'; text = `Not available yet: ${st.extras.join(', ')}. Submitting sends a request to the data team to build it. Delivery starts once they finish.`; }
  else if (graph.nodes.length === 1) { tone = 'warn'; text = 'Start by clicking a source above, or drag one onto the canvas.'; }
  else if (st.miss) { tone = 'warn'; text = 'Some steps are not connected yet. Drag from a right-hand dot to a left-hand dot.'; }
  else { tone = 'ok'; text = 'Ready. Every column exists today, so no engineering is needed.'; }

  const sqlNote = sql.ok ? `SQL ready: ${sql.result.summary.length - 1} steps, ${sql.result.outputColumns.length} columns.` : `SQL not ready: ${sql.issues[0]?.message ?? ''}`;

  return (
    <div className="builder">
      <div className="builder-main">
        <Palette app={app} />
        <div className="toolbar">
          <span className="toolbar-hint">Click a block to insert it after the selected step, or drag it in. Drag from a right dot to a left dot to connect.</span>
          <div className="toolbar-btns">
            <div className="zoom">
              <button title="Zoom out (Ctrl and minus)" aria-label="Zoom out" onClick={() => app.zoomBy(-0.1)}>−</button>
              <button className="zoom-label" title="Reset zoom (Ctrl and 0)" onClick={() => app.setZoom(1)}>{Math.round(zoom * 100)}%</button>
              <button title="Zoom in (Ctrl and plus)" aria-label="Zoom in" onClick={() => app.zoomBy(0.1)}>+</button>
            </div>
            <button className="btn sm" onClick={app.tidy}>Tidy up</button>
            <button className="btn sm" onClick={app.resetFlow}>Start over</button>
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column' }}>
          <Canvas app={app} />
          {previewOpen && (
            <div className="overlay" onClick={() => setPreviewOpen(false)}>
              <div className="modal" role="dialog" aria-label="Preview" onClick={(e) => e.stopPropagation()}>
                <div className="modal-head"><span className="modal-title">Preview</span><button className="btn sm" onClick={() => setPreviewOpen(false)}>Close</button></div>
                <div className="muted" style={{ marginBottom: 12 }}>
                  What the client receives on each run. {fin.rows.length} rows, {fin.cols.length} columns.{st.extras.length ? ' Missing columns are not included.' : ''}
                </div>
                <DataTable table={fin} limit={8} />
                <div className="mono" style={{ marginTop: 12, color: 'var(--ink-3)', wordBreak: 'break-all' }}>{s3Path(s3.cfg.client!, s3.cfg.folder!)}</div>
              </div>
            </div>
          )}
        </div>
        <div className="banner" style={{ background: `var(--${tone}-bg)`, borderColor: `var(--${tone})` }}>
          <span className="banner-dot" style={{ background: `var(--${tone})` }} />
          <span style={{ lineHeight: 1.45 }}>
            {text}
            <div className="banner-note">{sqlNote} <button className="link" onClick={() => setTab('sql')}>View SQL</button></div>
          </span>
        </div>
      </div>
      <StepPanel app={app} tab={tab} setTab={setTab} />
    </div>
  );
}
