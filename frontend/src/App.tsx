import { useState } from 'react';
import { schemaVersion } from './lib/catalog';
import { useApp, type Page } from './lib/useApp';
import { NewRequest } from './pages/NewRequest';
import { ApprovalsPage, CatalogPage, MinePage, PreviewPage } from './pages/Lists';

const NAV: [Page, string][] = [['catalog', 'Report catalog'], ['new', 'New request'], ['mine', 'My requests'], ['appr', 'Approvals'], ['prev', 'Preview data']];

const TITLES: Record<Page, [string, string]> = {
  catalog: ['Report catalog', 'Datasets you can use as sources.'],
  new: ['New client report request', 'Build it by connecting blocks. We tell you if it is ready or needs building.'],
  mine: ['My requests', 'Everything you have requested and its live status.'],
  appr: ['Approvals', "Approve, reject or re-route. The label is the system's classification."],
  prev: ['Preview data', 'What the client receives, read from the warehouse.'],
};

export function App() {
  const app = useApp();
  const [previewOpen, setPreviewOpen] = useState(false);
  const { page, st } = app;
  const pending = app.requests.filter((r) => r.status === 'Pending').length;
  const [title, sub] = TITLES[page];

  let statusLabel = 'Ready to submit', statusBg = 'var(--ok-bg)';
  if (st.extras.length) { statusLabel = 'Needs new data'; statusBg = 'var(--warn-bg)'; }
  else if (st.miss) { statusLabel = 'Incomplete'; statusBg = 'var(--warn-bg)'; }

  return (
    <div className="shell">
      <div className="shell-inner">
        <div className="topbar">
          <div className="brand">
            <span className="brand-mark">S3</span>
            <span>Data team · Client Reports to S3<div className="brand-sub">Request, customize &amp; approve client report exports</div></span>
          </div>
          <div className="topbar-right">
            <span className="pill-info" title="Columns, types and descriptions come from the dbt schema.yml">Schema {schemaVersion} · dbt</span>
            <span className="avatar">You</span>
          </div>
        </div>
        <div className="body">
          <nav className="nav" aria-label="Main">
            {NAV.map(([k, label]) => (
              <button key={k} className={'nav-item' + (page === k ? ' on' : '')} aria-current={page === k ? 'page' : undefined} onClick={() => app.setPage(k)}>
                <span>{label}</span>
                {k === 'appr' && pending > 0 && <span className="badge">{pending}</span>}
              </button>
            ))}
          </nav>
          <div className="main">
            <div className="page-head">
              <div style={{ minWidth: 0 }}><h2>{title}</h2><div className="page-sub">{sub}</div></div>
              {page === 'new' && (
                <div className="head-actions">
                  <span className="status-pill" style={{ background: statusBg }}>{statusLabel}</span>
                  <button className="btn" onClick={() => setPreviewOpen(true)}>Preview data</button>
                  <button className="btn primary" onClick={app.submit}>Submit for approval</button>
                </div>
              )}
            </div>
            {page === 'new' && <NewRequest app={app} previewOpen={previewOpen} setPreviewOpen={setPreviewOpen} />}
            {page === 'catalog' && <CatalogPage app={app} />}
            {page === 'mine' && <MinePage app={app} />}
            {page === 'appr' && <ApprovalsPage app={app} />}
            {page === 'prev' && <PreviewPage app={app} />}
          </div>
        </div>
        {app.toast && <div className="toast" role="status">{app.toast}</div>}
      </div>
    </div>
  );
}
