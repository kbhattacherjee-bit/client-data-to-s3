import { useState } from 'react';
import { DataTable } from '../components/DataTable';
import { SqlPanel } from '../components/SqlPanel';
import { compileFlow } from '../lib/sql';
import { clients, datasets, s3Path } from '../lib/catalog';
import { analyse } from '../lib/graph';
import type { AppState } from '../lib/useApp';
import type { RequestStatus } from '../lib/types';

export const STATUS_BG: Record<RequestStatus, string> = {
  Approved: 'var(--ok-bg)', Pending: 'var(--warn-bg)', 'In data-eng': 'var(--accent-bg)',
  Paused: 'var(--hover)', Rejected: 'var(--hover)', Draft: 'var(--hover)', 'Needs attention': 'var(--warn-bg)',
};

export function CatalogPage({ app }: { app: AppState }) {
  return (
    <div className="page-scroll">
      <div className="col-narrow">
        {Object.values(datasets).map((d) => (
          <div key={d.key} className="list-card split">
            <div>
              <div style={{ fontWeight: 500 }}>{d.name}</div>
              <div className="mono" style={{ color: 'var(--ink-3)', marginTop: 2 }}>{d.table}</div>
              <div className="muted" style={{ marginTop: 6, fontSize: 13, maxWidth: 560 }}>{d.desc}</div>
              <div className="small" style={{ color: 'var(--ink-3)', marginTop: 4 }}>
                {d.cols.length} columns{d.hidden.length ? ` · ${d.hidden.length} restricted` : ''}{d.reference ? ' · reference data' : ''}
              </div>
            </div>
            <button className="btn primary" style={{ flexShrink: 0 }} onClick={() => app.startWith(d.key)}>Start a request</button>
          </div>
        ))}
        <div className="small muted">Do not see your fields? Start a request and add the column by name. We route it to data engineering.</div>
      </div>
    </div>
  );
}

export function MinePage({ app }: { app: AppState }) {
  return (
    <div className="page-scroll">
      <div className="table-wrap" style={{ maxWidth: 980 }}>
        <table>
          <thead><tr>{['Request', 'Client', 'Status', 'Last delivered'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>
            {app.requests.map((r) => (
              <tr key={r.id} className="click" onClick={() => app.loadGraph(r.graph, 's3')}>
                <td style={{ fontWeight: 500 }}>{r.name}</td>
                <td>{clients[r.client].name}</td>
                <td><span className="tag" style={{ background: STATUS_BG[r.status] }}>{r.status}</span></td>
                <td className="muted">{r.last}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ApprovalsPage({ app }: { app: AppState }) {
  const pending = app.requests.filter((r) => r.status === 'Pending');
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="page-scroll">
      <div className="col-narrow">
        {pending.length === 0 && <div className="muted">Nothing waiting for approval.</div>}
        {pending.map((r) => {
          const { st } = analyse(r.graph);
          const needs = st.extras.length > 0;
          const steps = r.graph.nodes.filter((n) => n.type !== 's3').length;
          return (
            <div key={r.id} className="list-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <div style={{ fontWeight: 500 }}>{r.name}, {clients[r.client].name}</div>
                  <div className="muted" style={{ marginTop: 3 }}>Requested by {r.by}. {steps} steps.{needs ? ` Missing: ${st.extras.join(', ')}.` : ''}</div>
                </div>
                <span className="tag" style={{ background: needs ? 'var(--warn-bg)' : 'var(--ok-bg)' }}>{needs ? 'Needs new layer' : 'Config-only'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                <button className="btn" style={{ fontWeight: 400 }} aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? 'Hide SQL' : 'Review SQL'}</button>
                <button className="btn" style={{ fontWeight: 400 }} onClick={() => { app.setPrevId(r.id); app.setPage('prev'); }}>Preview</button>
                <button className="btn" style={{ fontWeight: 400 }} onClick={() => app.setStatus(r.id, 'Rejected')}>Reject</button>
                <button className="btn primary" onClick={() => { app.setStatus(r.id, needs ? 'In data-eng' : 'Approved'); app.showToast(needs ? 'Data-engineering ticket DATASD-4821 opened.' : 'Approved.'); }}>
                  {needs ? 'Route to data-eng' : 'Approve'}
                </button>
              </div>
              {open === r.id && <div className="review"><SqlPanel outcome={compileFlow(r.graph, r.client)} /></div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PreviewPage({ app }: { app: AppState }) {
  const pv = app.requests.find((r) => r.id === app.prevId) ?? app.requests[0];
  const { T } = analyse(pv.graph);
  const s3 = pv.graph.nodes.find((n) => n.type === 's3')!;
  return (
    <div className="page-scroll">
      <div className="col-narrow" style={{ maxWidth: 900 }}>
        <select className="field" style={{ maxWidth: 420, padding: '9px 12px' }} value={pv.id} onChange={(e) => app.setPrevId(e.target.value)}>
          {app.requests.map((r) => <option key={r.id} value={r.id}>{r.name}, {clients[r.client].name}</option>)}
        </select>
        <div className="muted">Exactly what the client receives, read from the warehouse.</div>
        <DataTable table={T[s3.id]} limit={12} />
        <div className="mono" style={{ color: 'var(--ink-3)', wordBreak: 'break-all' }}>{s3Path(s3.cfg.client!, s3.cfg.folder!)}</div>
      </div>
    </div>
  );
}
