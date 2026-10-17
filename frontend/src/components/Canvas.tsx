import { useEffect, useRef, useState } from 'react';
import { clients, datasets } from '../lib/catalog';
import { NODE_H, NODE_W, PORTS } from '../lib/graph';
import type { AppState } from '../lib/useApp';
import { isGroup, type Edge, type FlowNode, type NodeType, type Port, type RuleItem, type Table } from '../lib/types';
import { Icon, type IconName } from './Icon';

const bez = (a: number[], b: number[]) => {
  const k = Math.max(40, Math.abs(b[0] - a[0]) / 2);
  return `M${a[0]} ${a[1]} C${a[0] + k} ${a[1]} ${b[0] - k} ${b[1]} ${b[0] - 2} ${b[1]}`;
};
const outPos = (n: FlowNode) => [n.x + NODE_W, n.y + NODE_H / 2];
const inPos = (n: FlowNode, p: Port) => [n.x, n.y + NODE_H * PORTS[n.type].find((q) => q[0] === p)![1]];

const countRules = (items: RuleItem[]): number => items.reduce((n, x) => n + (isGroup(x) ? countRules(x.rules) : 1), 0);

export const NODE_ICON: Record<NodeType, IconName> = {
  source: 'database', select: 'columns', filter: 'filter', group: 'sigma', addcol: 'addcol', join: 'join', union: 'union', s3: 'upload',
};
const OPS = { '+': '+', '-': '−', '*': '×', '/': '÷' } as const;

function describe(n: FlowNode, t: Table): { kicker: string; title: string; sub: string; warn: boolean } {
  const c = n.cfg;
  let warn = !!t.warn; // an unconnected step is incomplete, not wrong: the empty port already says so
  let kicker = '', title = '', sub = '';
  switch (n.type) {
    case 'source': { const d = datasets[c.ds!]; kicker = 'Source'; title = d.name; sub = d.table; break; }
    case 'select':
      kicker = 'Select columns';
      title = t.err ? 'Connect an input' : t.cols.length + ' columns';
      sub = c.extras!.length ? 'Missing: ' + c.extras!.join(', ') : c.drop!.length ? 'Hiding ' + c.drop!.length : 'All kept';
      if (c.extras!.length) warn = true;
      break;
    case 'filter': {
      kicker = 'Filter rows';
      const k = countRules(c.rules ?? []);
      title = k ? k + (k === 1 ? ' rule' : ' rules') : 'No rules';
      sub = t.err ?? t.rows.length + ' rows remain';
      break;
    }
    case 'group':
      kicker = 'Group by';
      title = c.by?.length ? c.by.join(', ') : 'Choose columns';
      sub = c.by?.length ? `${c.aggs?.length ?? 0} total${c.aggs?.length === 1 ? '' : 's'}` : t.err ?? 'Not set';
      break;
    case 'addcol':
      kicker = 'Add column';
      title = c.name || 'Name it';
      sub = c.a ? `${c.a} ${OPS[c.op ?? '*']} ${c.b || c.num}` : t.err ?? 'Not set';
      break;
    case 'join':
      kicker = 'Join';
      title = c.key ? 'on ' + c.key : 'Choose a key';
      sub = t.err ?? (c.type === 'left' ? 'Keep all left rows' : 'Matching rows only');
      break;
    case 'union': kicker = 'Union'; title = 'Stack two inputs'; sub = t.err ?? t.rows.length + ' rows'; break;
    case 's3': kicker = 'Deliver'; title = 'Amazon S3'; sub = clients[c.client!].name + ' · ' + c.fmt; break;
  }
  return { kicker, title, sub, warn };
}

const portTitle = (type: NodeType, p: Port) => ({ in: 'Input', a: type === 'join' ? 'Left' : 'First', b: type === 'join' ? 'Right' : 'Second' })[p];

export function Canvas({ app }: { app: AppState }) {
  const { graph, T, zoom, selected } = app;
  const canvasRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  /** `replacing` is set while an existing arrow is being moved: it is hidden until dropped on an input, and kept if dropped elsewhere. */
  const link = useRef<{ from: string; replacing?: Edge } | null>(null);
  const [moving, setMoving] = useState<Edge | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [linkPos, setLinkPos] = useState<[number, number] | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [hoverEdge, setHoverEdge] = useState<Edge | null>(null);
  const leaveTimer = useRef<number>();

  const live = useRef(app);
  live.current = app;

  // Bring a newly selected or added step into view, easing unless the user prefers reduced motion.
  useEffect(() => {
    if (!selected) return;
    const el = canvasRef.current?.querySelector<HTMLElement>(`[data-id="${selected}"]`);
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el?.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'nearest', inline: 'nearest' });
  }, [selected, graph.nodes.length]);

  const toCanvas = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = canvasRef.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / live.current.zoom, (e.clientY - r.top) / live.current.zoom];
  };

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!canvasRef.current) return;
      const [mx, my] = toCanvas(e);
      if (drag.current) live.current.moveNode(drag.current.id, Math.max(0, mx - drag.current.dx), Math.max(0, my - drag.current.dy));
      else if (link.current) setLinkPos([mx, my]);
    };
    const up = () => {
      drag.current = null;
      setDragging(null);
      if (link.current) { link.current = null; setLinkPos(null); setMoving(null); }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, []);

  const byId = (id: string) => graph.nodes.find((n) => n.id === id)!;
  const cw = Math.max(900, ...graph.nodes.map((n) => n.x + NODE_W + 60));
  const ch = Math.max(440, ...graph.nodes.map((n) => n.y + NODE_H + 60));

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const [kind, key] = e.dataTransfer.getData('text/plain').split(':');
    const [x, y] = toCanvas(e);
    const pos: [number, number] = [Math.max(0, x - NODE_W / 2), Math.max(0, y - NODE_H / 2)];
    if (kind === 'source') app.addFn('source', key, pos);
    else if (kind === 'fn') app.addFn(key as NodeType, undefined, pos);
  };

  const showEdgeControl = (e: Edge) => hoverEdge === e || e.from === selected || e.to === selected;
  const hoverOn = (e: Edge) => { window.clearTimeout(leaveTimer.current); setHoverEdge(e); };
  const hoverOff = () => { window.clearTimeout(leaveTimer.current); leaveTimer.current = window.setTimeout(() => setHoverEdge(null), 140); };

  return (
    <div className="canvas-scroll" onMouseDown={(e) => { if (!(e.target as HTMLElement).closest('.node, .port, .edge-x')) app.setSelected(''); }}>
      <div style={{ width: cw * zoom, height: ch * zoom }}>
        <div
          ref={canvasRef}
          className="canvas"
          style={{ width: cw, height: ch, transform: `scale(${zoom})` }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
        >
          <svg width={cw} height={ch}>
            <defs>
              {[['arrG', '#A6A6AE'], ['arrB', '#2E21DE']].map(([id, color]) => (
                <marker key={id} id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                  <path d="M0 1 L9 5 L0 9" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </marker>
              ))}
            </defs>
            {graph.edges.map((e, i) => {
              if (e === moving) return null;
              const d = bez(outPos(byId(e.from)), inPos(byId(e.to), e.port));
              const hi = e.from === selected || e.to === selected || hoverEdge === e;
              return (
                <g key={i}>
                  <path d={d} fill="none" stroke={hi ? '#2E21DE' : '#A6A6AE'} strokeWidth={hi ? 2 : 1.5} markerEnd={hi ? 'url(#arrB)' : 'url(#arrG)'} style={{ transition: 'stroke 200ms cubic-bezier(0.22,1,0.36,1)' }} />
                  <path className="hit" d={d} fill="none" stroke="transparent" strokeWidth={16} onMouseEnter={() => hoverOn(e)} onMouseLeave={hoverOff} />
                </g>
              );
            })}
            {link.current && linkPos && <path d={bez(outPos(byId(link.current.from)), [linkPos[0] + 2, linkPos[1]])} fill="none" stroke="#2E21DE" strokeWidth="1.8" strokeDasharray="5 4" />}
          </svg>

          {graph.edges.map((e, i) => {
            if (e === moving) return null;
            const A = outPos(byId(e.from)), B = inPos(byId(e.to), e.port);
            return (
              <button
                key={i}
                className={'edge-x' + (showEdgeControl(e) ? ' show' : '')}
                title="Remove connection"
                aria-label="Remove connection"
                style={{ left: (A[0] + B[0]) / 2, top: (A[1] + B[1]) / 2 }}
                onMouseEnter={() => hoverOn(e)}
                onMouseLeave={hoverOff}
                onClick={() => app.removeEdge(e)}
              >
                <Icon name="x" size={12} />
              </button>
            );
          })}

          {graph.nodes.map((n) => {
            const d = describe(n, T[n.id]);
            if (!app.sql.ok && app.sql.issues.some((i) => i.nodeId === n.id && i.code !== 'MISSING_INPUT')) d.warn = true;
            const on = n.id === selected;
            return (
              <div
                key={n.id}
                data-id={n.id}
                className={'node' + (n.type === 'source' ? ' source' : '') + (n.type === 's3' ? ' output' : '') + (on ? ' on' : '') + (dragging === n.id ? ' dragging' : '')}
                style={{ left: n.x, top: n.y }}
                onMouseDown={(e) => {
                  const [mx, my] = toCanvas(e);
                  drag.current = { id: n.id, dx: mx - n.x, dy: my - n.y };
                  setDragging(n.id);
                  app.setSelected(n.id);
                }}
                onMouseEnter={() => setHover(n.id)}
                onMouseLeave={() => setHover(null)}
              >
                <div className="node-head">
                  <span className="node-icon"><Icon name={NODE_ICON[n.type]} size={14} /></span>
                  <span className="node-kicker">{d.kicker}</span>
                  {d.warn && <span className="node-warn" title="Needs attention"><Icon name="alert" size={14} /></span>}
                </div>
                <div className="node-title">{d.title}</div>
                <div className="node-sub">{d.sub}</div>
                {n.type !== 's3' && (hover === n.id || on) && (
                  <button className="node-del" title="Delete this step" aria-label="Delete this step" onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); app.delNode(n.id); }}>
                    <Icon name="x" size={12} />
                  </button>
                )}
                {PORTS[n.type].map(([p, f]) => {
                  const edge = graph.edges.find((x) => x.to === n.id && x.port === p);
                  const label = portTitle(n.type, p) + (edge ? ' (drag to move this arrow)' : '');
                  return (
                    <button
                      key={p}
                      className={'port' + (edge ? ' filled movable' : '')}
                      title={label}
                      aria-label={label}
                      style={{ left: -12, top: NODE_H * f - 12 }}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        if (!edge) return;
                        e.preventDefault();
                        link.current = { from: edge.from, replacing: edge };
                        setMoving(edge);
                        setLinkPos(toCanvas(e));
                      }}
                      onMouseUp={() => { if (link.current) app.connect(link.current.from, n.id, p, link.current.replacing); }}
                    />
                  );
                })}
                {n.type !== 's3' && (
                  <button
                    className="port out"
                    title="Drag to connect"
                    aria-label="Drag to connect"
                    style={{ left: NODE_W - 12, top: NODE_H / 2 - 12 }}
                    onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); link.current = { from: n.id }; }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
