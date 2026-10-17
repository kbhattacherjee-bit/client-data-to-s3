import { useCallback, useEffect, useRef, useState } from 'react';
import { LAYOUT_SPRING, ZOOM_SPRING } from './motion';
import { SpringSet } from './spring';
import { datasets } from './catalog';
import { compileFlow, firstBlocking } from './sql';
import { analyse, blankFlow, chain, cleanGraph, defCfg, layout, NODE_H, NODE_W, PORTS, reach, seedRequests, stepName } from './graph';
import type { Cfg, Edge, FlowNode, Graph, NodeType, Port, ReportRequest, RequestStatus } from './types';

export type Page = 'catalog' | 'new' | 'mine' | 'appr' | 'prev';
export interface ToastMessage { text: string; action?: { label: string; run: () => void } }

export const MIN_ZOOM = 0.3;
export const MAX_ZOOM = 1.6;

/**
 * All client-side state. Everything here is local mock state; when the API exists the request
 * list, submit and approve/reject actions become API calls, and the flow state becomes a draft
 * saved with PUT /api/requests/:id (SPEC section 11).
 */
export function useApp() {
  const [page, setPage] = useState<Page>('new');
  const [graph, setGraph] = useState<Graph>(blankFlow);
  const [selected, setSelected] = useState(''); // nothing selected on load: the panel shows guidance, not an error
  const [zoom, setZoom] = useState(1);
  const [requests, setRequests] = useState<ReportRequest[]>(seedRequests);
  const [prevId, setPrevId] = useState('R-101');
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [announcement, setAnnouncement] = useState({ text: '', n: 0 });
  const nextId = useRef(10);
  const reqN = useRef(105);
  const toastTimer = useRef<number>();

  /** A short message at the bottom of the screen. With an action (such as Undo) it stays a little longer. */
  const showToast = useCallback((text: string, action?: ToastMessage['action']) => {
    setToast({ text, action });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), action ? 7000 : 3200);
  }, []);
  /** Tells screen-reader users what just happened (shown nowhere, read aloud politely). */
  const announce = useCallback((text: string) => setAnnouncement((a) => ({ text, n: a.n + 1 })), []);

  // Layout changes and zoom glide on critically damped springs (no overshoot, interruptible, velocity carries over).
  const graphRef = useRef(graph);
  graphRef.current = graph;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const zoomTarget = useRef(1);
  const springs = useRef<SpringSet>(); // card positions
  const zoomSpring = useRef<SpringSet>();
  if (!springs.current) {
    springs.current = new SpringSet(LAYOUT_SPRING, (v) => {
      setGraph((g) => ({
        ...g,
        nodes: g.nodes.map((n) => {
          const x = v[n.id + '.x'];
          const y = v[n.id + '.y'];
          return x === undefined && y === undefined ? n : { ...n, x: x ?? n.x, y: y ?? n.y };
        }),
      }));
    });
    zoomSpring.current = new SpringSet(ZOOM_SPRING, (v) => v.zoom !== undefined && setZoom(v.zoom));
  }
  useEffect(() => () => { springs.current?.dispose(); zoomSpring.current?.dispose(); }, []);

  /** Applies a graph whose node positions are the targets: existing nodes glide there, new ones appear in place. */
  const commit = (g: Graph) => {
    const targets: Record<string, number> = {};
    const current: Record<string, number> = {};
    const nodes = g.nodes.map((n) => {
      targets[n.id + '.x'] = n.x;
      targets[n.id + '.y'] = n.y;
      const old = graphRef.current.nodes.find((o) => o.id === n.id);
      if (!old) return n;
      current[n.id + '.x'] = old.x;
      current[n.id + '.y'] = old.y;
      return { ...n, x: old.x, y: old.y };
    });
    setGraph({ nodes, edges: g.edges });
    springs.current!.retarget(targets, current);
  };
  /** A different flow is loaded: stop any motion that belonged to the previous one. */
  const stopNodeMotion = () => springs.current!.cancelWhere(() => true);

  const { nodes } = graph;
  const view = cleanGraph(nodes, graph.edges);
  const { T, st } = analyse(view);
  const sql = compileFlow(view);

  const zoomTo = useCallback((t: number) => {
    zoomTarget.current = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(t * 100) / 100));
    zoomSpring.current!.retarget({ zoom: zoomTarget.current }, { zoom: zoomRef.current });
  }, []);
  const zoomBy = useCallback((d: number) => zoomTo(zoomTarget.current + d), [zoomTo]);
  /** Follows a pinch gesture 1:1, with no spring in between. */
  const zoomNow = useCallback((t: number) => {
    zoomTarget.current = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, t));
    zoomSpring.current!.jump({ zoom: zoomTarget.current });
  }, []);

  const patchCfg = (id: string, patch: Cfg | ((c: Cfg) => Cfg)) =>
    setGraph((g) => ({
      ...g,
      nodes: g.nodes.map((n) => (n.id === id ? { ...n, cfg: { ...n.cfg, ...(typeof patch === 'function' ? patch(n.cfg) : patch) } } : n)),
    }));

  /** Dragging is 1:1 with the pointer: no animation, and any glide in progress for that node is dropped. */
  const moveNode = (id: string, x: number, y: number) => {
    springs.current!.cancel([id + '.x', id + '.y']);
    setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)) }));
  };

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
    // Insert after the selected step; with nothing (or the output) selected, append just before the output.
    const sel = graph.nodes.find((n) => n.id === selected);
    const feeder = graph.edges.find((e) => e.to === s3.id)?.from;
    const anchor = graph.nodes.find((n) => n.id === (sel && sel.type !== 's3' ? sel.id : feeder));
    if (!pos && anchor && type !== 'source') {
      const inPort = PORTS[type][0][0];
      const down = edges.find((e) => e.from === anchor.id);
      if (down) edges = edges.map((e) => (e === down ? { ...e, from: id } : e));
      else if (s3Free) edges.push({ from: id, to: s3.id, port: 'in' });
      edges.push({ from: anchor.id, to: id, port: inPort });
    } else if (type === 'source' && graph.nodes.length === 1 && s3Free) {
      edges.push({ from: id, to: s3.id, port: 'in' }); // first source on a blank canvas
    }
    if (type === 'source' && !s3.cfg.folder && key) {
      nodes = nodes.map((n) => (n.id === s3.id ? { ...n, cfg: { ...n.cfg, folder: datasets[key].folder } } : n));
    }
    const g: Graph = { nodes, edges };
    if (pos) setGraph(g);
    else commit(layout(g));
    setSelected(id);
    announce(`Added ${stepName(node)}${anchor && !pos && type !== 'source' ? ` after ${stepName(anchor)}` : ''}.`);
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
    const before = { graph: graphRef.current, selected };
    commit(layout({ nodes: graph.nodes.filter((x) => x.id !== n.id), edges }));
    setSelected(up || '');
    announce(`Deleted ${stepName(n)}.`);
    showToast(`Deleted ${stepName(n)}`, {
      label: 'Undo',
      run: () => { commit(before.graph); setSelected(before.selected); announce(`Restored ${stepName(n)}.`); setToast(null); },
    });
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
    const a = graph.nodes.find((x) => x.id === from);
    const b = graph.nodes.find((x) => x.id === to);
    if (a && b) announce(`Connected ${stepName(a)} to ${stepName(b)}.`);
  };

  const removeEdge = (e: Edge) => {
    setGraph((g) => ({ ...g, edges: g.edges.filter((q) => q !== e) }));
    const a = graph.nodes.find((x) => x.id === e.from);
    const b = graph.nodes.find((x) => x.id === e.to);
    if (a && b) announce(`Disconnected ${stepName(a)} from ${stepName(b)}.`);
  };
  /** Arranges the steps and, given the visible size, eases the zoom out just enough to show the whole flow. */
  const tidy = (viewport?: { w: number; h: number }) => {
    const g = layout(cleanGraph(graphRef.current.nodes, graphRef.current.edges));
    commit(g);
    announce('Steps arranged.');
    if (viewport) {
      const w = Math.max(...g.nodes.map((n) => n.x + NODE_W)) + 24;
      const h = Math.max(...g.nodes.map((n) => n.y + NODE_H)) + 24;
      zoomTo(Math.max(MIN_ZOOM, Math.floor(Math.min(1, (viewport.w - 24) / w, (viewport.h - 212) / h) * 100) / 100));
    }
  };
  const resetFlow = () => {
    stopNodeMotion();
    setGraph(blankFlow());
    setSelected('');
    announce('Canvas cleared.');
  };

  const loadGraph = (g: Graph, sel: string) => {
    stopNodeMotion();
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
  const live = useRef({ page, delNode, zoomBy, zoomTo });
  live.current = { page, delNode, zoomBy, zoomTo };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { page: p, zoomBy: zb, zoomTo: zt } = live.current;
      if (p !== 'new') return;
      if (e.ctrlKey || e.metaKey) {
        if (e.key === '=' || e.key === '+') { e.preventDefault(); zb(0.1); }
        else if (e.key === '-' || e.key === '_') { e.preventDefault(); zb(-0.1); }
        else if (e.key === '0') { e.preventDefault(); zt(1); }
        return;
      }
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
    page, setPage, graph: view, T, st, sql, selected, setSelected, zoom, zoomTo, zoomBy, zoomNow,
    requests, prevId, setPrevId, toast, showToast, announcement,
    patchCfg, moveNode, addFn, delNode, connect, removeEdge, tidy, resetFlow, loadGraph, startWith, submit, setStatus,
  };
}

export type AppState = ReturnType<typeof useApp>;
