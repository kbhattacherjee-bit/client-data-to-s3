import { useState } from 'react';

/** A list of values: type one and press Enter or comma; paste a comma or line separated list. */
export function ChipsInput({ values, onChange, label }: { values: string[]; onChange: (v: string[]) => void; label: string }) {
  const [text, setText] = useState('');
  const commit = (raw: string) => {
    const parts = raw.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
    if (parts.length) onChange(values.concat(parts.filter((x) => !values.includes(x))));
    setText('');
  };
  return (
    <div className="stack-sm">
      {values.length > 0 && (
        <div className="chips">
          {values.map((v) => (
            <button key={v} className="toggle on" title="Remove" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}>{v} ×</button>
          ))}
        </div>
      )}
      <input
        className="field"
        aria-label={label}
        value={text}
        placeholder="Type a value, press Enter"
        onChange={(e) => (/[,\n]/.test(e.target.value) ? commit(e.target.value) : setText(e.target.value))}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(text); } }}
        onBlur={() => commit(text)}
      />
    </div>
  );
}
