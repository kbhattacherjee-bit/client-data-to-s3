import { useCallback, useEffect, useRef, useState } from 'react';
import { datasets } from './catalog';
import { compileFlow, firstBlocking } from './sql';
import { analyse, blankFlow, chain, cleanGraph, defCfg, layout, PORTS, reach, seedRequests } from './graph';
import type { Cfg, Edge, FlowNode, Graph, NodeType, Port, ReportRequest, RequestStatus } from './types';

export type Page = 'catalog' | 'new' | 'mine' | 'appr' | 'prev';

export const MIN_ZOOM = 0.4;
export const MAX_ZOOM = 1.6;

/**
 * All client-side state. Everything here is local mock state; when the API exists the request
 * list, submit and approve/reject actions become API calls, and the flow state becomes a draft
 * saved with PUT /api/requests/:id (SPEC section 11).
 */
export function useApp() {
  const [page, setPage] = useState<Page>('new');
  const [graph, setGraph] = useState<Graph>(blankFlow);
  const [selected, setSelected] = useState('s3');
  const [zoom, setZoom] = useState(1);
  const [requests, setRequests] = useState<ReportRequest[]>(seedRequests);
  const [prevId, setPrevId] = useState('R-101');
  const [toast, setToastText] = useState('');
  const nextId = useRef(10);
  const reqN = useRef(105);
  const toastTimer = useRef<number>();

  const showToast = useCallback((t: string) => {
    setToastText(t);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastText(''), 3200);
  }, []);

  const { nodes } = graph;
  const view = cleanGraph(nodes, graph.edges);
  const { T, st } = analyse(view);
  const sql = compileFlow(view);

  const zoomBy = useCallback((d: number) => setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round((z + d) * 100) / 100))), []);

  const patchCfg = (id: string, patch: Cfg | ((c: Cfg) => Cfg)) =>
    setGraph((g) => ({
      ...g,
      nodes: g.nodes.map((n) => (n.id === id ? { ...n, cfg: { ...n.cfg, ...(typeof patch === 'function' ? patch(n.cfg) : patch) } } : n)),
    }));

  const moveNode = (id: string, x: number, y: number) =>
    setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)) }));

  /**
   * Adds a step. With no position it is inserted after the selected step and the flow is tidied.
   * A step with nothing after it is joined to the S3 output when that is still unconnected, so a new flow is never left dangling.
   */
  const addFn = (type: NodeType, key?: string, pos?: [number, number]) => {
    const id = 'n' + nextId.current++;
    const node: FlowNode = { id, type, x: pos ? pos[0] : 0, y: pos ? pos[1] : 0, cfg: defCfg(type, key) };
    let edges = graph.edges.slice();
    let nodes = graph.nodes.concat(node);
    const s3 = graph.nodes.find((n) => n.type === 's3')!;
    const s3Free = !edges.some((e) => e.to === s3.id);
    const sel = graph.nodes.find((n) => n.id === selected);
    if (!pos && sel && sel.type !== 's3' && type !== 'source') {
      const inPort = PORTS[type][0][0];
      const down = edges.find((e) => e.from === sel.id);
      if (down) edges = edges.map((e) => (e === down ? { ...e, from: id } : e));
      else if (s3Free) edges.push({ from: id, to: s3.id, port: 'in' });
      edges.push({ from: sel.id, to: id, port: inPort });
    } else if (type === 'source' && graph.nodes.length === 1 && s3Free) {
      edges.push({ from: id, to: s3.id, port: 'in' }); // first source on a blank canvas
    }
    if (type === 'source' && !s3.cfg.folder && key) {
      nodes = nodes.map((n) => (n.id === s3.id ? { ...n, cfg: { ...n.cfg, folder: datasets[key].folder } } : n));
    }
    let g: Graph = { nodes, edges };
    if (!pos) g = layout(g);
    setGraph(g);
    setSelected(id);
  };

  /** Deletes a step and re-wires its first upstream step to everything it fed. */
  const delNode = (id: string = selected) => {
    const n = graph.nodes.find((x) => x.id === id);
    if (!n || n.type === 's3') return;
    const ins = graph.edges.filter((e) => e.to === n.id);
    const outs = graph.edges.filter((e) => e.from === n.id);
    const up = ins[0]?.from;
    let edges = graph.edges.filter((e) => e.to !== n.id && e.from !== n.id);
    if (up) edges = edges.concat(outs.map((e) => ({ ...e, from: up })));
    setGraph(layout({ nodes: graph.nodes.filter((x) => x.id !== n.id), edges }));
    setSelected(up || 's3');
  };

  /** Connects `from` to an input. With `replacing`, that arrow is moved instead of a new one added. */
  const connect = (from: string, to: string, port: Port, replacing?: Edge) => {
    if (from === to) return;
    const base: Graph = replacing ? { ...graph, edges: graph.edges.filter((e) => e !== replacing) } : graph;
    if (reach(base, to, from)) {
      showToast('That would create a loop.');
      return;
    }
    setGraph((g) => ({ ...g, edges: g.edges.filter((e) => e !== replacing && !(e.to === to && e.port === port)).concat({ from, to, port }) }));
  };

  const removeEdge = (e: Edge) => setGraph((g) => ({ ...g, edges: g.edges.filter((q) => q !== e) }));
  const tidy = () => setGraph((g) => layout(cleanGraph(g.nodes, g.edges)));
  const resetFlow = () => {
    setGraph(blankFlow());
    setSelected('s3');
  };

  const loadGraph = (g: Graph, sel: string) => {
    setGraph({ nodes: g.nodes, edges: g.edges });
    setSelected(sel);
    setPage('new');
  };
  const startWith = (ds: string) => {
    const s3 = graph.nodes.find((n) => n.type === 's3')!;
    loadGraph(chain(ds, [], s3.cfg.client ?? 'acme'), 'n1');
  };

  const submit = () => {
    if (st.miss) return showToast('Connect every step before submitting.');
    const blocking = firstBlocking(sql);
    if (blocking) return showToast(blocking.message);
    const src = graph.nodes.find((n) => n.type === 'source')!;
    const s3 = graph.nodes.find((n) => n.type === 's3')!;
    const needs = st.extras.length > 0;
    const id = 'R-' + reqN.current++;
    const req: ReportRequest = {
      id,
      name: needs ? 'New fields: ' + st.extras[0] : datasets[src.cfg.ds!].name,
      client: s3.cfg.client!,
      status: 'Pending',
      last: '—',
      by: 'You',
      graph: { nodes: graph.nodes, edges: graph.edges },
    };
    setRequests((r) => [req, ...r]);
    setPage('mine');
    showToast(needs ? 'Sent for approval. Approving it opens a data-engineering ticket.' : 'Sent for approval. Data Ops reviews it before files start landing.');
  };

  const setStatus = (id: string, status: RequestStatus) => setRequests((r) => r.map((x) => (x.id === id ? { ...x, status } : x)));

  // Keyboard: Ctrl/Cmd +/-/0 zoom, wheel zoom, Delete removes the selected step (not while typing).
  const live = useRef({ page, delNode, zoomBy });
  live.current = { page, delNode, zoomBy };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { page: p, delNode: del, zoomBy: zb } = live.current;
      if (p !== 'new') return;
      if (e.ctrlKey || e.metaKey) {
        if (e.key === '=' || e.key === '+') { e.preventDefault(); zb(0.1); }
        else if (e.key === '-' || e.key === '_') { e.preventDefault(); zb(-0.1); }
        else if (e.key === '0') { e.preventDefault(); setZoom(1); }
        return;
      }
      const tag = document.activeElement?.tagName ?? '';
      if ((e.key === 'Delete' || e.key === 'Backspace') && !/INPUT|SELECT|TEXTAREA/.test(tag)) del();
    };
    const onWheel = (e: WheelEvent) => {
      if ((e.ctrlKey || e.metaKey) && live.current.page === 'new') {
        e.preventDefault();
        live.current.zoomBy(e.deltaY < 0 ? 0.1 : -0.1);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', onWheel);
    };
  }, []);

  return {
    page, setPage, graph: view, T, st, sql, selected, setSelected, zoom, setZoom, zoomBy,
    requests, prevId, setPrevId, toast, showToast,
    patchCfg, moveNode, addFn, delNode, connect, removeEdge, tidy, resetFlow, loadGraph, startWith, submit, setStatus,
  };
}

export type AppState = ReturnType<typeof useApp>;
