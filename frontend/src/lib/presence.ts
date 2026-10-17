import { useEffect, useState } from 'react';

/**
 * Keeps an element mounted while it animates out, so exit mirrors entry (same path, reversed).
 * `visible` flips one frame after mount so the CSS transition has a start state to move from.
 */
export function usePresence(open: boolean, exitMs = 240) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      let b = 0;
      const a = requestAnimationFrame(() => { b = requestAnimationFrame(() => setVisible(true)); });
      return () => { cancelAnimationFrame(a); cancelAnimationFrame(b); };
    }
    setVisible(false);
    const t = window.setTimeout(() => setMounted(false), exitMs);
    return () => window.clearTimeout(t);
  }, [open, exitMs]);
  return { mounted, visible };
}
