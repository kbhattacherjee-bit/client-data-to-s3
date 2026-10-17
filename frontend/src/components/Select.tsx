import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePresence } from '../lib/presence';
import { useMediaQuery } from '../lib/useMediaQuery';
import { Icon } from './Icon';

export interface Option { value: string; label: string }

interface Props {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  /** accessible name, e.g. "Comparison" */
  label: string;
  inline?: boolean;
}

/**
 * A styled dropdown. With a mouse or keyboard it opens a translucent menu that eases out of the control; on a touch
 * screen it falls back to the native picker, which is the better experience on a phone (wheel on iOS, full-screen list on Android).
 */
export function Select(props: Props) {
  const touch = useMediaQuery('(hover: none)');
  return touch ? <NativeSelect {...props} /> : <Dropdown {...props} />;
}

function NativeSelect({ value, options, onChange, label, inline }: Props) {
  return (
    <select className={'field' + (inline ? ' inline' : '')} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

const ROW = 34;

function Dropdown({ value, options, onChange, label, inline }: Props) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const { mounted, visible } = usePresence(open, 180);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState({ left: 0, top: 0, bottom: 0, width: 0, maxH: 280, up: false });
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: '', timer: 0 });

  const selected = options.findIndex((o) => o.value === value);
  const current = options[selected];
  const optId = (i: number) => `${uid}-o${i}`;

  const show = () => {
    const r = btn.current!.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 14;
    const above = r.top - 14;
    const need = Math.min(options.length * ROW + 8, 280);
    const up = below < need && above > below; // flip above when there is no room below
    const width = Math.max(r.width, 200);
    setPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
      top: r.bottom + 6,
      bottom: window.innerHeight - r.top + 6,
      width,
      maxH: Math.max(120, Math.min(280, up ? above : below)),
      up,
    });
    setActive(Math.max(0, selected));
    setOpen(true);
  };
  const close = () => setOpen(false);
  const choose = (i: number) => {
    const o = options[i];
    if (o) onChange(o.value);
    close();
    btn.current?.focus();
  };

  // outside click, scrolling elsewhere and resizing all put the menu away
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !list.current?.contains(t)) close();
    };
    const scroll = (e: Event) => { if (!list.current?.contains(e.target as Node)) close(); };
    window.addEventListener('pointerdown', down);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('pointerdown', down); window.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', close); };
  }, [open]);

  // keep the active option in view while moving with the keyboard
  useEffect(() => {
    if (open && mounted) document.getElementById(optId(active))?.scrollIntoView({ block: 'nearest' });
  }, [active, open, mounted]); // eslint-disable-line react-hooks/exhaustive-deps

  const typeahead = (ch: string) => {
    const t = typed.current;
    window.clearTimeout(t.timer);
    t.text += ch.toLowerCase();
    t.timer = window.setTimeout(() => (t.text = ''), 700);
    const n = options.length;
    for (let k = 1; k <= n; k++) {
      const i = (active + (t.text.length > 1 ? 0 : 1) + k - 1) % n; // keep growing a prefix, or move on to the next match
      if (options[i]!.label.toLowerCase().startsWith(t.text)) { if (!open) show(); setActive(i); return; }
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const n = options.length;
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key) || (e.key === ' ' && !typed.current.text)) { e.preventDefault(); show(); }
      else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) typeahead(e.key);
      return;
    }
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); setActive((a) => Math.min(n - 1, a + 1)); break;
      case 'ArrowUp': e.preventDefault(); setActive((a) => Math.max(0, a - 1)); break;
      case 'PageDown': e.preventDefault(); setActive((a) => Math.min(n - 1, a + 8)); break;
      case 'PageUp': e.preventDefault(); setActive((a) => Math.max(0, a - 8)); break;
      case 'Home': e.preventDefault(); setActive(0); break;
      case 'End': e.preventDefault(); setActive(n - 1); break;
      case ' ':
        e.preventDefault();
        if (typed.current.text) typeahead(' '); // mid-search, a space is a letter
        else choose(active);
        break;
      case 'Enter': e.preventDefault(); choose(active); break;
      case 'Escape': e.preventDefault(); e.stopPropagation(); close(); break; // closes the menu, not the dialog behind it
      case 'Tab': close(); break;
      default: if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) typeahead(e.key);
    }
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        role="combobox"
        className={'field select' + (inline ? ' inline' : '') + (value === '' ? ' placeholder' : '')}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${uid}-list` : undefined}
        aria-activedescendant={open ? optId(active) : undefined}
        onClick={() => (open ? close() : show())}
        onKeyDown={onKeyDown}
      >
        <span className="select-value">{current?.label ?? ''}</span>
        <Icon name="chevron" size={16} className="select-chevron" />
      </button>
      {mounted && createPortal(
        <div role="region" aria-label={`${label} options`} style={{ display: 'contents' }}>
        <div
          ref={list}
          id={`${uid}-list`}
          role="listbox"
          aria-label={label}
          className={'menu' + (visible ? ' in' : '') + (pos.up ? ' up' : '')}
          style={{ left: pos.left, minWidth: pos.width, maxHeight: pos.maxH, ...(pos.up ? { bottom: pos.bottom } : { top: pos.top }) }}
          onPointerDown={(e) => e.preventDefault() /* keep focus on the control */}
        >
          {options.map((o, i) => (
            <div
              key={o.value}
              id={optId(i)}
              role="option"
              aria-selected={i === selected}
              title={o.label}
              className={'menu-item' + (i === active ? ' active' : '') + (o.value === '' ? ' muted' : '')}
              onPointerEnter={() => setActive(i)}
              onClick={() => choose(i)}
            >
              <span className="menu-label">{o.label}</span>
              {i === selected && <Icon name="check" size={16} className="menu-check" />}
            </div>
          ))}
        </div>
        </div>,
        document.body,
      )}
    </>
  );
}
