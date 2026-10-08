/**
 * MOCK ONLY. Stands in for "compile to SQL and run in Snowflake" (SPEC sections 7 and 8).
 * It mirrors the prototype's run() so the UI behaves the same. Replace the calls to
 * evalAll() with the preview API once the backend exists; nothing else should import this file.
 * Sample rows are in the order of each dataset's visible columns.
 */
import { datasets } from './catalog';
import type { Cell, Graph, FlowNode, Table } from './types';

const MOCK: Record<string, Cell[][]> = {
  soft_dollar_client_report: [
    ['2026-10-06', 'AAPL', 1180, 295, 885], ['2026-10-06', 'MSFT', 920, 230, 690],
    ['2026-10-06', 'NVDA', 1980, 495, 1485], ['2026-10-06', 'TSLA', 710, 178, 532],
    ['2026-10-07', 'AAPL', 1240, 310, 930], ['2026-10-07', 'MSFT', 980, 245, 735],
    ['2026-10-07', 'NVDA', 2115, 529, 1586], ['2026-10-07', 'JPM', 1530, 382, 1148],
  ],
  client_positions_report: [
    ['2026-10-07', 'AAPL', 12500, 2400000], ['2026-10-07', 'MSFT', 8200, 3400000],
    ['2026-10-07', 'NVDA', 4950, 700000], ['2026-10-07', 'TSLA', 3100, 800000],
    ['2026-10-07', 'JPM', 9700, 1900000], ['2026-10-06', 'AAPL', 12000, 2300000],
    ['2026-10-06', 'MSFT', 8200, 3350000], ['2026-10-06', 'NVDA', 4950, 690000],
  ],
  commission_summary: [
    ['2026-10-07', 'Cash', 'AAPL', 1500, 120, 60, 1320], ['2026-10-07', 'Cash', 'MSFT', 1100, 90, 45, 965],
    ['2026-10-07', 'Options', 'NVDA', 2600, 310, 140, 2150], ['2026-10-07', 'Options', 'TSLA', 900, 60, 35, 805],
    ['2026-10-06', 'Cash', 'JPM', 1700, 140, 70, 1490], ['2026-10-06', 'Options', 'AAPL', 1300, 110, 55, 1135],
  ],
  security_master: [
    ['AAPL', 'Technology', 'NASDAQ'], ['MSFT', 'Technology', 'NASDAQ'], ['NVDA', 'Technology', 'NASDAQ'],
    ['TSLA', 'Consumer', 'NASDAQ'], ['JPM', 'Financials', 'NYSE'],
  ],
};

const r2 = (x: number) => Math.round(x * 100) / 100;
const fail = (m: string): Table => ({ cols: [], types: [], rows: [], err: m });

type Input = (port: 'in' | 'a' | 'b') => Table | null;

export function run(n: FlowNode, inp: Input): Table {
  const c = n.cfg;
  if (n.type === 'source') {
    const d = datasets[c.ds!];
    return { cols: d.cols, types: d.types, rows: MOCK[d.key] ?? [] };
  }

  if (n.type === 'join' || n.type === 'union') {
    const A = inp('a');
    const B = inp('b');
    if (!A || !B) return fail('Connect both inputs');
    if (A.err) return A;
    if (B.err) return B;
    if (n.type === 'union') {
      const cols = A.cols.concat(B.cols.filter((x) => !A.cols.includes(x)));
      const align = (T: Table, r: Cell[]) => cols.map((x) => { const i = T.cols.indexOf(x); return i >= 0 ? r[i] : ''; });
      const types = cols.map((x) => { const i = A.cols.indexOf(x); return i >= 0 ? A.types[i] : B.types[B.cols.indexOf(x)]; });
      return { cols, types, rows: A.rows.map((r) => align(A, r)).concat(B.rows.map((r) => align(B, r))) };
    }
    const key = c.key && A.cols.includes(c.key) && B.cols.includes(c.key) ? c.key : null;
    if (!key) return { ...A, warn: 'Choose a key' };
    const ka = A.cols.indexOf(key);
    const kb = B.cols.indexOf(key);
    const extra = B.cols.map((_, i) => i).filter((i) => i !== kb && !A.cols.includes(B.cols[i]));
    const rows: Cell[][] = [];
    A.rows.forEach((ar) => {
      const ms = B.rows.filter((br) => br[kb] === ar[ka]);
      if (ms.length) ms.forEach((br) => rows.push(ar.concat(extra.map((i) => br[i]))));
      else if (c.type === 'left') rows.push(ar.concat(extra.map(() => '')));
    });
    return { cols: A.cols.concat(extra.map((i) => B.cols[i])), types: A.types.concat(extra.map((i) => B.types[i])), rows };
  }

  const a = inp('in');
  if (!a) return fail(n.type === 's3' ? 'Connect a step to this output' : 'Connect an input');
  if (a.err) return a;
  if (n.type === 's3') return a;

  if (n.type === 'select') {
    const keep = a.cols.map((_, i) => i).filter((i) => !c.drop!.includes(a.cols[i]));
    return { cols: keep.map((i) => a.cols[i]), types: keep.map((i) => a.types[i]), rows: a.rows.map((r) => keep.map((i) => r[i])) };
  }

  if (n.type === 'filter') {
    const rs = c.rules!.filter((r) => r.val !== '' && a.cols.includes(r.col)).map((r) => ({ ...r, i: a.cols.indexOf(r.col) }));
    return {
      ...a,
      rows: a.rows.filter((row) =>
        rs.every((r) => {
          const raw = row[r.i];
          const num = typeof raw === 'number';
          const v = num ? parseFloat(r.val) : r.val.toLowerCase();
          const x = num ? raw : String(raw).toLowerCase();
          if (num && Number.isNaN(v)) return true;
          switch (r.op) {
            case 'gt': return x > v;
            case 'lt': return x < v;
            case 'eq': return x === v;
            case 'ne': return x !== v;
            default: return String(x).includes(String(v));
          }
        }),
      ),
    };
  }

  if (n.type === 'group') {
    const bi = a.cols.indexOf(c.by ?? '');
    if (bi < 0) return { ...a, warn: 'Choose a column' };
    const ni = a.cols.map((_, i) => i).filter((i) => i !== bi && a.types[i] === 'number');
    const groups = new Map<Cell, Cell[][]>();
    a.rows.forEach((r) => { if (!groups.has(r[bi])) groups.set(r[bi], []); groups.get(r[bi])!.push(r); });
    const agg = c.agg ?? 'sum';
    return {
      cols: [c.by!, 'row_count'].concat(ni.map((i) => agg + '_' + a.cols[i])),
      types: [a.types[bi], 'number' as const].concat(ni.map(() => 'number' as const)),
      rows: [...groups].map(([k, rs]) => [k, rs.length as Cell].concat(ni.map((i) => {
        const v = rs.map((r) => r[i] as number);
        const total = v.reduce((p, q) => p + q, 0);
        return agg === 'sum' ? r2(total) : agg === 'avg' ? r2(total / v.length) : Math.max(...v);
      }))),
    };
  }

  if (n.type === 'addcol') {
    if (!c.name || !c.a || !a.cols.includes(c.a)) return { ...a, warn: 'Choose a column' };
    const ai = a.cols.indexOf(c.a);
    const bi = c.b ? a.cols.indexOf(c.b) : -1;
    const num = parseFloat(c.num ?? '');
    const name = a.cols.includes(c.name) ? c.name + '_2' : c.name;
    if (a.types[ai] !== 'number') return { ...a, warn: `"${c.a}" is not a number column` };
    if (bi >= 0 && a.types[bi] !== 'number') return { ...a, warn: `"${c.b}" is not a number column` };
    return {
      cols: a.cols.concat(name),
      types: a.types.concat('number'),
      rows: a.rows.map((r) => {
        const x = r[ai];
        const y = bi >= 0 ? r[bi] : num;
        let v: Cell = '';
        if (typeof x === 'number' && typeof y === 'number' && !Number.isNaN(y)) {
          const raw = c.op === '+' ? x + y : c.op === '-' ? x - y : c.op === '*' ? x * y : y ? x / y : null;
          v = raw === null ? '' : r2(raw); // divide by zero gives NULL (blank here)
        }
        return r.concat([v]);
      }),
    };
  }
  return a;
}

/** Evaluates every node. Cycles are guarded with a depth limit, as in the prototype. */
export function evalAll(g: Graph): Record<string, Table> {
  const T: Record<string, Table> = {};
  const ev = (id: string, depth: number): Table => {
    if (T[id]) return T[id];
    if (depth > 25) return fail('Loop');
    const n = g.nodes.find((x) => x.id === id)!;
    return (T[id] = run(n, (p) => {
      const e = g.edges.find((q) => q.to === id && q.port === p);
      return e ? ev(e.from, depth + 1) : null;
    }));
  };
  g.nodes.forEach((n) => ev(n.id, 0));
  return T;
}
