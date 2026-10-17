import { useEffect, useState } from 'react';
import { usePresence } from '../lib/presence';
import type { ToastMessage } from '../lib/useApp';

/** Keeps its last message while it fades out, so the exit mirrors the entrance. */
export function Toast({ toast }: { toast: ToastMessage | null }) {
  const [shown, setShown] = useState<ToastMessage | null>(null);
  useEffect(() => { if (toast) setShown(toast); }, [toast]);
  const { mounted, visible } = usePresence(!!toast, 360);
  if (!mounted || !shown) return null;
  return (
    <div className={'toast' + (visible ? ' in' : '')} role="status">
      <span>{shown.text}</span>
      {shown.action && <button className="toast-action" onClick={shown.action.run}>{shown.action.label}</button>}
    </div>
  );
}
