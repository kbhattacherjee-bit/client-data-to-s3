import { useEffect, useState } from 'react';
import { usePresence } from '../lib/presence';

/** Keeps its last message while it fades out, so the exit mirrors the entrance. */
export function Toast({ text }: { text: string }) {
  const [shown, setShown] = useState('');
  useEffect(() => { if (text) setShown(text); }, [text]);
  const { mounted, visible } = usePresence(!!text, 360);
  if (!mounted) return null;
  return <div className={'toast' + (visible ? ' in' : '')} role="status">{shown}</div>;
}
