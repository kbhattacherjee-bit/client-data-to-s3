import { useCallback, useState } from 'react';
import { Icon, type IconName } from './components/Icon';
import { Toast } from './components/Toast';
import { schemaVersion } from './lib/catalog';
import { useApp, type Page } from './lib/useApp';
import { ApprovalsPage, CatalogPage, MinePage, PreviewPage } from './pages/Lists';
import { NewRequest, type PreviewState } from './pages/NewRequest';

const NAV: [Page, string, IconName][] = [
  ['catalog', 'Report catalog', 'layers'], ['new', 'New request', 'plus'], ['mine', 'My requests', 'list'], ['appr', 'Approvals', 'approve'], ['prev', 'Preview data', 'table'],
];

const TITLES: Record<Page, [string, string]> = {
  catalog: ['Report catalog', 'Datasets you can use as sources.'],
  new: ['New client report', 'Build it by connecting steps. We tell you if it is ready or needs building.'],
  mine: ['My requests', 'Everything you have requested and its live status.'],
  appr: ['Approvals', 'Review, approve, reject or re-route.'],
  prev: ['Preview data', 'What the client receives, read from the warehouse.'],
};

export function App() {
  const app = useApp();
  const [preview, setPreview] = useState<PreviewState>({ open: false, origin: null });
  const closePreview = useCallback(() => setPreview((p) => ({ ...p, open: false })), []);
  const { page, st, graph } = app;
  const pending = app.requests.filter((r) => r.status === 'Pending').length;
  const [title, sub] = TITLES[page];

  let statusLabel = 'Ready to submit', tone = 'ok';
  if (graph.nodes.length === 1) { statusLabel = 'Not started'; tone = ''; }
  else if (st.extras.length) { statusLabel = 'Needs new data'; tone = 'warn'; }
  else if (st.miss) { statusLabel = 'Incomplete'; tone = 'warn'; }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><Icon name="upload" size={16} /></span>
          <span className="brand-name">Client reports</span>
          <span className="brand-sep" />
          <span className="brand-sub">Data team</span>
        </div>
        <div className="topbar-right">
          <span className="chip-info" title="Columns, types and descriptions come from the dbt schema.yml">Schema {schemaVersion} · dbt</span>
          <span className="avatar" aria-label="Signed in as you">You</span>
        </div>
      </header>
      <div className="body">
        <nav className="nav" aria-label="Main">
          {NAV.map(([k, label, icon]) => (
            <button key={k} className={'nav-item' + (page === k ? ' on' : '')} aria-current={page === k ? 'page' : undefined} onClick={() => app.setPage(k)}>
              <Icon name={icon} size={16} />
              <span className="grow">{label}</span>
              {k === 'appr' && pending > 0 && <span className="badge" aria-label={`${pending} waiting`}>{pending}</span>}
            </button>
          ))}
        </nav>
        <main className="main">
          <div className="page-head">
            <div style={{ minWidth: 0 }}><h1 className="t-title">{title}</h1><div className="page-sub">{sub}</div></div>
            {page === 'new' && (
              <div className="head-actions">
                <span className={'status ' + tone}>{statusLabel}</span>
                <button className="btn" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setPreview({ open: true, origin: { x: r.left + r.width / 2, y: r.top + r.height / 2 } }); }}>Preview data</button>
                <button className="btn primary" onClick={app.submit}>Submit for approval</button>
              </div>
            )}
          </div>
          {page === 'new' && <NewRequest app={app} preview={preview} closePreview={closePreview} />}
          {page === 'catalog' && <CatalogPage app={app} />}
          {page === 'mine' && <MinePage app={app} />}
          {page === 'appr' && <ApprovalsPage app={app} />}
          {page === 'prev' && <PreviewPage app={app} />}
        </main>
      </div>
      <Toast text={app.toast} />
    </div>
  );
}
