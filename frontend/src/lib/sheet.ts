import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { SHEET_SPRING } from './motion';
import { SpringSet } from './spring';

export type Snap = 'peek' | 'half' | 'full';
const PEEK = 112; // px of the sheet showing when collapsed
const DECEL = 0.998; // scroll-like deceleration used to project where a flick would land

/** How far a flick would carry on its own (px). Exponential decay, the form Apple ships, not v²/2a. */
const project = (v: number) => ((v / 1000) * DECEL) / (1 - DECEL);
/** Resistance that grows with distance past an edge, so the sheet never hard-stops. */
const rubberband = (over: number, dim: number) => (over * dim * 0.55) / (dim + 0.55 * Math.abs(over));

/**
 * A bottom sheet with three resting heights. While dragged it follows the finger 1:1 (with rubber-banding past the ends).
 * On release it projects the flick forward, picks the nearest resting height, and springs there carrying the release speed.
 * Grabbing it mid-flight takes over from its live position. offset 0 = fully open, larger = lower.
 */
export function useSheet(enabled: boolean, panel: RefObject<HTMLElement>) {
  const [snap, setSnap] = useState<Snap>('peek');
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [H, setH] = useState(0); // height of the area the sheet lives in
  const offsetRef = useRef(0);
  offsetRef.current = offset;
  const springs = useRef<SpringSet>();
  if (!springs.current) springs.current = new SpringSet(SHEET_SPRING, (v) => v.y !== undefined && setOffset(v.y));
  useEffect(() => () => springs.current?.dispose(), []);

  const sheetH = Math.round(H * 0.9);
  const offsets: Record<Snap, number> = { full: 0, half: Math.max(0, sheetH - Math.round(H * 0.5)), peek: Math.max(0, sheetH - PEEK) };

  useEffect(() => {
    const el = panel.current?.parentElement;
    if (!enabled || !el) return;
    const ro = new ResizeObserver(() => setH(el.clientHeight));
    setH(el.clientHeight);
    ro.observe(el);
    return () => ro.disconnect();
  }, [enabled, panel]);

  // Tell the canvas where the sheet's top edge is, so floating controls can ride on it (see .float-row).
  useEffect(() => {
    const el = panel.current?.parentElement;
    if (!el) return;
    if (!enabled) { el.style.removeProperty('--sheet-visible'); delete el.dataset.sheet; return; }
    el.style.setProperty('--sheet-visible', Math.max(0, sheetH - offset) + 'px');
    el.dataset.sheet = snap;
  }, [enabled, sheetH, offset, snap, panel]);

  // Settle on the current snap whenever it, or the available height, changes (not while a finger is down).
  const first = useRef(true);
  useEffect(() => {
    if (!enabled || !H || dragging) return;
    if (first.current) { first.current = false; springs.current!.jump({ y: offsets[snap] }); return; }
    springs.current!.retarget({ y: offsets[snap] }, { y: offsetRef.current });
  }, [enabled, snap, H]); // eslint-disable-line react-hooks/exhaustive-deps

  const g = useRef<{ startY: number; startOffset: number; hist: { t: number; y: number }[]; moved: boolean } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!enabled) return;
    const t = e.target as HTMLElement;
    if (t.closest('button') && !t.closest('.sheet-handle')) return; // tabs and other buttons keep their clicks
    e.currentTarget.setPointerCapture(e.pointerId);
    springs.current!.cancel(['y']); // take over from wherever it is
    g.current = { startY: e.clientY, startOffset: offsetRef.current, hist: [{ t: e.timeStamp, y: e.clientY }], moved: false };
    setDragging(true);
  }, [enabled]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const d = g.current;
    if (!d) return;
    d.hist.push({ t: e.timeStamp, y: e.clientY });
    if (d.hist.length > 6) d.hist.shift();
    const dy = e.clientY - d.startY;
    if (Math.abs(dy) > 4) d.moved = true;
    let o = d.startOffset + dy;
    if (o < offsets.full) o = offsets.full - rubberband(offsets.full - o, H);
    else if (o > offsets.peek) o = offsets.peek + rubberband(o - offsets.peek, H);
    setOffset(o);
  }, [H, offsets.full, offsets.peek]);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const d = g.current;
    if (!d) return;
    g.current = null;
    setDragging(false);
    const first = d.hist[0]!, last = d.hist[d.hist.length - 1]!;
    const dt = Math.max(1, last.t - first.t) / 1000;
    const v = d.moved ? (last.y - first.y) / dt : 0; // px/s, positive = downward
    let next: Snap;
    if (!d.moved) next = snap === 'peek' ? 'half' : snap === 'half' ? 'full' : 'peek'; // a tap cycles the heights
    else {
      const landing = offsetRef.current + project(v);
      next = (Object.keys(offsets) as Snap[]).reduce((a, b) => (Math.abs(offsets[b] - landing) < Math.abs(offsets[a] - landing) ? b : a));
    }
    setSnap(next);
    springs.current!.retarget({ y: offsets[next] }, { y: offsetRef.current }, { y: v }); // hand the release speed to the spring
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  }, [offsets.full, offsets.half, offsets.peek, snap]); // eslint-disable-line react-hooks/exhaustive-deps

  return { snap, setSnap, offset, sheetH, dragging, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp } };
}
