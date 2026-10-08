import { useState } from 'react';
import type { SqlOutcome } from '../lib/sql';

export function SqlPanel({ outcome, hint }: { outcome: SqlOutcome; hint?: boolean }) {
  const [copied, setCopied] = useState(false);
  if (!outcome.ok) {
    return (
      <div className="stack">
        <div className="label" style={{ margin: 0 }}>SQL is not available yet</div>
        <ul className="issue-list">{outcome.issues.map((i, k) => <li key={k}>{i.message}</li>)}</ul>
        {hint && <div className="small muted">SQL is generated for flows made of sources, Select columns and Filter rows. Remove other steps to see it.</div>}
      </div>
    );
  }
  const { result } = outcome;
  const binds = Object.entries(result.params);
  const copy = () => {
    navigator.clipboard?.writeText(result.sql).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }, () => {});
  };
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div>
        <div className="label">What this does</div>
        <ol className="summary-list">{result.summary.map((t, k) => <li key={k}>{t}</li>)}</ol>
      </div>
      {result.warnings.length > 0 && (
        <div className="warn-box">{result.warnings.map((w, k) => <div key={k}>{w}</div>)}</div>
      )}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span className="label" style={{ margin: 0 }}>SQL</span>
          <button className="btn sm" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
        </div>
        <pre className="sql-block" tabIndex={0}>{result.sql}</pre>
      </div>
      <div>
        <div className="label">Values sent separately</div>
        <div className="small muted" style={{ marginBottom: 6 }}>Never written into the SQL text.</div>
        <div className="table-wrap mini">
          <table><tbody>
            {binds.map(([k, v]) => <tr key={k}><td className="mono">:{k}</td><td className="mono">{JSON.stringify(v)}</td></tr>)}
            {binds.length === 0 && <tr><td className="muted">None</td></tr>}
          </tbody></table>
        </div>
      </div>
      <div className="small muted">Delivery: {result.delivery.fmt} to the "{result.delivery.folder}" folder for {result.delivery.client}. {result.outputColumns.length} columns.</div>
    </div>
  );
}
