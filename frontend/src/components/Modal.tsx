import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePresence } from '../lib/presence';
import { Icon } from './Icon';

export interface Origin { x: number; y: number }

/**
 * Enters from the control that opened it and leaves along the same path. The surface eases from a point
 * halfway toward its trigger, so the spatial relationship is clear. Escape or a click outside closes it.
 */
export function Modal({ open, onClose, origin, title, children }: { open: boolean; onClose: () => void; origin: Origin | null; title: string; children: React.ReactNode }) {
  const { mounted, visible } = usePresence(open, 360);
  const ref = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState({ dx: 0, dy: 0 });

  useLayoutEffect(() => {
    if (!mounted || !origin || !ref.current) return;
    const r = ref.current.getBoundingClientRect(); // hidden state scales about the centre, so the centre is still true here
    setOffset({ dx: (origin.x - (r.left + r.width / 2)) * 0.5, dy: (origin.y - (r.top + r.height / 2)) * 0.5 });
  }, [mounted, origin]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!mounted) return null;
  return (
    <div className={'overlay' + (visible ? ' in' : '')} onClick={onClose}>
      <div
        ref={ref}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={{ ['--dx' as string]: offset.dx + 'px', ['--dy' as string]: offset.dy + 'px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 className="t-panel">{title}</h2>
          <button className="btn ghost icon sm" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
