import { useState } from 'react';
import { DataTable } from '../components/DataTable';
import { Icon } from '../components/Icon';
import { SqlPanel } from '../components/SqlPanel';
import { clients, datasets, s3Path } from '../lib/catalog';
import { analyse } from '../lib/graph';
import { compileFlow } from '../lib/sql';
import type { AppState } from '../lib/useApp';
import type { RequestStatus } from '../lib/types';

export const STATUS_TONE: Record<RequestStatus, string> = {
  Approved: 'ok', Pending: 'warn', 'In data-eng': 'info', Paused: '', Rejected: 'bad', Draft: '', 'Needs attention': 'warn',
};

export function CatalogPage({ app }: { app: AppState }) {
  return (
    <div className="page-scroll">
      <div className="col-narrow">
        {Object.values(datasets).map((d) => (
          <div key={d.key} className="card lift split">
            <div style={{ minWidth: 0 }}>
              <div className="card-title">{d.name}</div>
              <div className="mono faint" style={{ marginTop: 2 }}>{d.table}</div>
              <p className="muted" style={{ marginTop: 8, maxWidth: 560 }}>{d.desc}</p>
              <div className="small faint" style={{ marginTop: 6 }}>
                {d.cols.length} columns{d.hidden.length ? ` · ${d.hidden.length} restricted` : ''}{d.reference ? ' · reference data' : ''}
              </div>
            </div>
            <button className="btn primary" style={{ flex: 'none' }} onClick={() => app.startWith(d.key)}>Start a request</button>
          </div>
        ))}
        <p className="small faint">Do not see your fields? Start a request and add the column by name. We route it to data engineering.</p>
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
              <tr key={r.id} className="click" tabIndex={0} onClick={() => app.loadGraph(r.graph, '')} onKeyDown={(e) => e.key === 'Enter' && app.loadGraph(r.graph, '')}>
                <td style={{ fontWeight: 500 }}>{r.name}</td>
                <td>{clients[r.client].name}</td>
                <td><span className={'status ' + STATUS_TONE[r.status]}>{r.status}</span></td>
                <td className="faint">{r.last}</td>
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
        {pending.length === 0 && (
          <div className="card" style={{ textAlign: 'center', padding: 40 }}>
            <Icon name="approve" size={28} />
            <div className="card-title" style={{ marginTop: 8 }}>Nothing waiting for approval</div>
            <p className="muted">New requests appear here as soon as they are submitted.</p>
          </div>
        )}
        {pending.map((r) => {
          const { st } = analyse(r.graph);
          const needs = st.extras.length > 0;
          const steps = r.graph.nodes.filter((n) => n.type !== 's3').length;
          const isOpen = open === r.id;
          return (
            <div key={r.id} className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <div className="card-title">{r.name}, {clients[r.client].name}</div>
                  <p className="muted" style={{ marginTop: 3 }}>Requested by {r.by}. {steps} steps.{needs ? ` Missing: ${st.extras.join(', ')}.` : ''}</p>
                </div>
                <span className={'status ' + (needs ? 'warn' : 'ok')}>{needs ? 'Needs new layer' : 'Config-only'}</span>
              </div>
              <div className="actions">
                <button className="btn" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.id)}>{isOpen ? 'Hide SQL' : 'Review SQL'}</button>
                <button className="btn" onClick={() => { app.setPrevId(r.id); app.setPage('prev'); }}>Preview</button>
                <button className="btn" onClick={() => app.setStatus(r.id, 'Rejected')}>Reject</button>
                <button className="btn primary" onClick={() => { app.setStatus(r.id, needs ? 'In data-eng' : 'Approved'); app.showToast(needs ? 'Data-engineering ticket DATASD-4821 opened.' : 'Approved.'); }}>
                  {needs ? 'Route to data-eng' : 'Approve'}
                </button>
              </div>
              <div className={'review' + (isOpen ? ' open' : '')} aria-hidden={!isOpen}>
                <div><div className="review-inner stack" style={{ gap: 18 }}>{isOpen && <SqlPanel outcome={compileFlow(r.graph, r.client)} />}</div></div>
              </div>
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
        <select className="field" style={{ maxWidth: 420 }} aria-label="Request" value={pv.id} onChange={(e) => app.setPrevId(e.target.value)}>
          {app.requests.map((r) => <option key={r.id} value={r.id}>{r.name}, {clients[r.client].name}</option>)}
        </select>
        <p className="muted">Exactly what the client receives, read from the warehouse.</p>
        <DataTable table={T[s3.id]} limit={12} />
        <div className="mono faint" style={{ wordBreak: 'break-all' }}>{s3Path(s3.cfg.client!, s3.cfg.folder!)}</div>
      </div>
    </div>
  );
}
