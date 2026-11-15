import {useEffect, useRef, useState} from 'react';

// Numeric input that lets you type freely and commits on blur or Enter.
export function NumField({value, onCommit, step = 0.01, min, max, id, disabled, suffix = 's', digits = 2, label}) {
  const [text, setText] = useState(Number(value).toFixed(digits)), focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(Number(value).toFixed(digits)); }, [value, digits]);
  const commit = () => {
    focused.current = false; const n = Number(text);
    if (!Number.isFinite(n) || text.trim() === '') { setText(Number(value).toFixed(digits)); return; }
    onCommit(n); setText(Number(value).toFixed(digits));
  };
  return (
    <span className="numfield">
      <input id={id} type="number" inputMode="decimal" aria-label={label} value={text} step={step} min={min} max={max} disabled={disabled}
        onFocus={() => { focused.current = true; }} onChange={e => setText(e.target.value)} onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setText(Number(value).toFixed(digits)); e.currentTarget.blur(); } }} />
      {suffix && <i>{suffix}</i>}
    </span>
  );
}
