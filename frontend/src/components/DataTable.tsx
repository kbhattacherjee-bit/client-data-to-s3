import { fmtCell } from '../lib/graph';
import type { Table } from '../lib/types';

/** Numbers are right-aligned with tabular figures so columns of money and counts line up. */
export function DataTable({ table, limit, mini }: { table: Table; limit: number; mini?: boolean }) {
  const num = (j: number) => table.types[j] === 'number';
  return (
    <div className={'table-wrap' + (mini ? ' mini' : '')} tabIndex={0} aria-label="Data preview">
      <table>
        <thead>
          <tr>{table.cols.map((c, i) => <th key={i} className={num(i) ? 'num' : undefined}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {table.rows.slice(0, limit).map((r, i) => (
            <tr key={i}>{r.map((v, j) => <td key={j} className={num(j) ? 'num' : undefined}>{fmtCell(table.cols[j], v)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
