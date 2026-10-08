import { fmtCell } from '../lib/graph';
import type { Table } from '../lib/types';

export function DataTable({ table, limit, mini }: { table: Table; limit: number; mini?: boolean }) {
  return (
    <div className={'table-wrap' + (mini ? ' mini' : '')}>
      <table>
        <thead>
          <tr>{table.cols.map((c) => <th key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {table.rows.slice(0, limit).map((r, i) => (
            <tr key={i}>{r.map((v, j) => <td key={j}>{fmtCell(table.cols[j], v)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
