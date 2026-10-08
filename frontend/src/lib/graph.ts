import { datasets, isCurrency } from './catalog';
import { evalAll } from './mockEngine';
import type { Cell, Cfg, Edge, FlowNode, Graph, NodeType, Port, ReportRequest, Table } from './types';

export const NODE_W = 184;
export const NODE_H = 84;

/** Input ports per step type with their vertical position (fraction of node height). */
export const PORTS: Record<NodeType, [Port, number][]> = {
  source: [],
  select: [['in', 0.5]],
  filter: [['in', 0.5]],
  group: [['in', 0.5]],
  addcol: [['in', 0.5]],
  join: [['a', 0.3], ['b', 0.72]],
  union: [['a', 0.3], ['b', 0.72]],
  s3: [['in', 0.5]],
};

export const FNS = {
  select: ['Select columns', 'Choose which columns to keep'],
  filter: ['Filter rows', 'Keep rows that match rules'],
  group: ['Group by', 'Total values by a column'],
  addcol: ['Add columns', 'Calculate a new column'],
  join: ['Join', 'Combine two datasets on a key'],
  union: ['Union', 'Stack two datasets'],
} as const;

export const defCfg = (type: NodeType, ds?: string): Cfg =>
  ({
    source: { ds },
    select: { drop: [], extras: [] },
    filter: { rules: [] },
    group: { by: '', agg: 'sum' },
    addcol: { name: 'new_field', a: '', op: '*', b: '', num: '1' },
    join: { key: '', type: 'inner' },
    union: {},
    s3: {},
  } satisfies Record<NodeType, Cfg>)[type];

/** Left-to-right auto layout by depth from the sources ("Tidy up"). */
export function layout(g: Graph): Graph {
  const depth: Record<string, number> = {};
  const d = (id: string, k: number): number => {
    if (depth[id] !== undefined) return depth[id];
    if (k > 20) return 0;
    const ins = g.edges.filter((e) => e.to === id);
    return (depth[id] = ins.length ? 1 + Math.max(...ins.map((e) => d(e.from, k + 1))) : 0);
  };
  const cols: Record<number, FlowNode[]> = {};
  const nodes = g.nodes.map((n) => ({ ...n }));
  nodes.forEach((n) => (cols[d(n.id, 0)] ||= []).push(n));
  Object.entries(cols).forEach(([k, ns]) =>
    ns.forEach((n, i) => {
      n.x = 24 + Number(k) * 224;
      n.y = 40 + i * 108;
    }),
  );
  return { nodes, edges: g.edges };
}

export function chain(ds: string, mids: { type: NodeType; cfg: Cfg }[], client: string): Graph {
  const nodes: FlowNode[] = [{ id: 'n1', type: 'source', x: 0, y: 0, cfg: { ds } }];
  const edges: Edge[] = [];
  let prev = 'n1';
  mids.forEach((m, i) => {
    const id = 'n' + (i + 2);
    nodes.push({ id, type: m.type, x: 0, y: 0, cfg: m.cfg });
    edges.push({ from: prev, to: id, port: 'in' });
    prev = id;
  });
  nodes.push({ id: 's3', type: 's3', x: 0, y: 0, cfg: { client, folder: datasets[ds].folder, fmt: 'CSV' } });
  edges.push({ from: prev, to: 's3', port: 'in' });
  return layout({ nodes, edges });
}

export function defaultFlow(): Graph {
  return layout({
    nodes: [
      { id: 'n1', type: 'source', x: 0, y: 0, cfg: { ds: 'soft_dollar_client_report' } },
      { id: 'n2', type: 'source', x: 0, y: 0, cfg: { ds: 'security_master' } },
      { id: 'n3', type: 'join', x: 0, y: 0, cfg: { key: 'symbol', type: 'inner' } },
      { id: 'n4', type: 'filter', x: 0, y: 0, cfg: { rules: [{ col: 'commission', op: 'gt', val: '1000' }] } },
      { id: 'n5', type: 'select', x: 0, y: 0, cfg: { drop: ['soft_dollar_amount', 'exchange'], extras: [] } },
      { id: 's3', type: 's3', x: 0, y: 0, cfg: { client: 'acme', folder: 'commissions_reports', fmt: 'CSV' } },
    ],
    edges: [
      { from: 'n1', to: 'n3', port: 'a' },
      { from: 'n2', to: 'n3', port: 'b' },
      { from: 'n3', to: 'n4', port: 'in' },
      { from: 'n4', to: 'n5', port: 'in' },
      { from: 'n5', to: 's3', port: 'in' },
    ],
  });
}

/** Mock requests so the list pages have something to show. Real ones come from the API. */
export function seedRequests(): ReportRequest[] {
  const gs = [
    chain('soft_dollar_client_report', [{ type: 'select', cfg: { drop: ['soft_dollar_amount', 'net_amount'], extras: [] } }], 'acme'),
    chain('client_positions_report', [{ type: 'filter', cfg: { rules: [{ col: 'quantity', op: 'gt', val: '5000' }] } }], 'acme'),
    chain('soft_dollar_client_report', [{ type: 'select', cfg: { drop: ['soft_dollar_amount', 'net_amount'], extras: ['strategy_id', 'realized_pnl'] } }], 'vertex'),
    chain('commission_summary', [{ type: 'group', cfg: { by: 'desk', agg: 'sum' } }], 'smac'),
  ];
  return [
    { id: 'R-101', name: 'Soft-dollar commissions', client: 'acme', status: 'Approved', last: '2026-10-07', by: 'S. Ponnapalli', graph: gs[0] },
    { id: 'R-102', name: 'Client positions', client: 'acme', status: 'Pending', last: '—', by: 'S. Ponnapalli', graph: gs[1] },
    { id: 'R-103', name: 'Realized P&L by strategy', client: 'vertex', status: 'Pending', last: '—', by: 'J. Doe', graph: gs[2] },
    { id: 'R-104', name: 'Commissions summary', client: 'smac', status: 'Paused', last: '2026-09-20', by: 'J. Doe', graph: gs[3] },
  ];
}

export const reach = (g: Graph, from: string, target: string): boolean => {
  const seen: Record<string, boolean> = {};
  const go = (id: string): boolean => {
    if (id === target) return true;
    if (seen[id]) return false;
    seen[id] = true;
    return g.edges.filter((e) => e.from === id).some((e) => go(e.to));
  };
  return go(from);
};

/** Drops edges that point at a missing node or a port the step does not have. */
export const cleanGraph = (nodes: FlowNode[], edges: Edge[]): Graph => {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return {
    nodes,
    edges: edges.filter((e) => byId.has(e.from) && byId.has(e.to) && PORTS[byId.get(e.to)!.type].some((p) => p[0] === e.port)),
  };
};

export interface FlowStatus {
  miss: boolean;
  extras: string[];
  final: Table;
}

export function status(g: Graph, T: Record<string, Table>): FlowStatus {
  const miss = g.nodes.some((n) => n.type !== 'source' && PORTS[n.type].some((p) => !g.edges.some((e) => e.to === n.id && e.port === p[0])));
  const extras = g.nodes.filter((n) => n.type === 'select').flatMap((n) => n.cfg.extras ?? []);
  return { miss, extras, final: T[g.nodes.find((n) => n.type === 's3')!.id] };
}

export const analyse = (g: Graph) => {
  const T = evalAll(g);
  return { T, st: status(g, T) };
};

export function fmtCell(col: string, v: Cell): string {
  if (typeof v !== 'number') return v === null || v === undefined ? '' : String(v);
  return (isCurrency(col) ? '$' : '') + v.toLocaleString('en-US', { maximumFractionDigits: 2 });
}
