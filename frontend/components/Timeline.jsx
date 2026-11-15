import clsx from 'clsx';
import {Plus} from 'lucide-react';
import {memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {FPS, clamp, clock, floorFrame, frame, quantizeFrames, stripUrl} from '../lib.js';
import {usePlayhead} from '../playhead.js';

const STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
const tickStep = pps => STEPS.find(s => s * pps >= 72) ?? 600;
const label = (t, step) => step < 1 ? clock(t) + '.' + String(Math.round((t % 1) * 10)) : clock(t);

export function Ruler({pps, extent, height = 26, ...rest}) {
  const step = tickStep(pps), ticks = [];
  for (let t = 0; t <= extent + step; t += step) ticks.push(+t.toFixed(3));
  return (
    <div className="ruler" style={{height, '--minor': (step / 5 * pps) + 'px'}} {...rest}>
      {ticks.map(t => <span key={t} className="tick" style={{left: t * pps}}><i>{label(t, step)}</i></span>)}
    </div>
  );
}

export function Playhead({pps, offset = 0, source}) {
  const cursor = usePlayhead(s => s.cursor);
  const t = source ?? cursor;
  return <div className="playhead" style={{transform: `translateX(${offset + t * pps}px)`}} aria-hidden="true"><span /></div>;
}

export function useWidth(ref) {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth)); ro.observe(el); setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

/* ---------- Reference selection: pick up to 3 seconds from the full source ---------- */
export function RangeTimeline({src, duration, start, length, maxLength = 3, minLength = 0.2, playhead, onChange, onSeek, disabled}) {
  const host = useRef(null), drag = useRef(null);
  const width = useWidth(host), pad = 14;
  const pps = Math.max(1, (width - pad * 2) / Math.max(duration, 0.1));
  const [live, setLive] = useState(null);
  const s = live?.start ?? start, e = live ? live.start + live.length : start + length;
  const strip = useMemo(() => src && width ? stripUrl(src, quantizeFrames(Math.ceil(width / 36))) : null, [src, width > 0]);

  const down = (kind) => ev => {
    if (disabled || ev.button !== 0) return;
    ev.preventDefault(); ev.stopPropagation(); ev.currentTarget.setPointerCapture(ev.pointerId);
    drag.current = {kind, x0: ev.clientX, start, end: start + length, len: length};
  };
  const compute = ev => {
    const d = drag.current, dt = (ev.clientX - d.x0) / pps;
    if (d.kind === 'left') { const ns = clamp(frame(d.start + dt), Math.max(0, d.end - maxLength), d.end - minLength); return {start: ns, length: d.end - ns}; }
    if (d.kind === 'right') { const ne = clamp(frame(d.end + dt), d.start + minLength, Math.min(duration, d.start + maxLength)); return {start: d.start, length: ne - d.start}; }
    const ns = clamp(frame(d.start + dt), 0, Math.max(0, duration - d.len)); return {start: ns, length: d.len};
  };
  const move = ev => { if (drag.current) { const next = compute(ev); setLive(next); } };
  const up = ev => { if (!drag.current) return; const kind = drag.current.kind, next = compute(ev); drag.current = null; setLive(null); onChange?.(next, kind); };
  const key = kind => ev => {
    const d = ev.shiftKey ? 1 : 1 / FPS; let n = null;
    if (ev.key === 'ArrowLeft') n = -d; else if (ev.key === 'ArrowRight') n = d; else return;
    ev.preventDefault();
    if (kind === 'left') { const ns = clamp(frame(start + n), Math.max(0, start + length - maxLength), start + length - minLength); onChange?.({start: ns, length: start + length - ns}, 'left'); }
    else if (kind === 'right') { const ne = clamp(frame(start + length + n), start + minLength, Math.min(duration, start + maxLength)); onChange?.({start, length: ne - start}, 'right'); }
    else onChange?.({start: clamp(frame(start + n), 0, Math.max(0, duration - length)), length}, 'move');
  };
  const seekAt = ev => { const r = host.current.getBoundingClientRect(); onSeek?.(clamp((ev.clientX - r.left - pad) / pps, 0, duration)); };
  const short = (e - s) < maxLength - 0.02;

  return (
    <div className={clsx('rtl', disabled && 'is-disabled')} ref={host}>
      <div className="rtl-strip" style={{marginInline: pad, backgroundImage: strip ? `url(${strip})` : undefined}} onPointerDown={ev => { if (ev.button === 0) { seekAt(ev); ev.currentTarget.setPointerCapture(ev.pointerId); drag.current = {kind: 'seek'}; } }}
        onPointerMove={ev => { if (drag.current?.kind === 'seek') seekAt(ev); }} onPointerUp={() => { if (drag.current?.kind === 'seek') drag.current = null; }}>
        <div className="rtl-dim" style={{left: 0, width: s * pps}} />
        <div className="rtl-dim" style={{left: e * pps, right: 0}} />
        <div className={clsx('rtl-window', short && 'is-short')} style={{left: s * pps, width: Math.max(8, (e - s) * pps)}}
          onPointerDown={down('move')} onPointerMove={move} onPointerUp={up} onPointerCancel={up} tabIndex={0} role="slider" aria-label="Selection start"
          aria-valuemin={0} aria-valuemax={duration} aria-valuenow={+s.toFixed(2)} aria-valuetext={`${s.toFixed(2)} to ${e.toFixed(2)} seconds`} onKeyDown={key('move')}>
          <span className="rtl-handle left" onPointerDown={down('left')} onPointerMove={move} onPointerUp={up} tabIndex={0} role="slider" aria-label="Selection in point" aria-valuenow={+s.toFixed(2)} onKeyDown={key('left')}><i /></span>
          <span className="rtl-handle right" onPointerDown={down('right')} onPointerMove={move} onPointerUp={up} tabIndex={0} role="slider" aria-label="Selection out point" aria-valuenow={+e.toFixed(2)} onKeyDown={key('right')}><i /></span>
          <span className="rtl-tag">{(e - s).toFixed(2)}s</span>
        </div>
        {playhead != null && <div className="rtl-needle" style={{transform: `translateX(${playhead * pps}px)`}} />}
      </div>
      <div className="rtl-scale" style={{marginInline: pad}} aria-hidden="true"><span>0:00</span><span>{clock(duration / 2)}</span><span>{clock(duration)}</span></div>
    </div>
  );
}

/* ---------- Sequence timeline: video clips, soundtrack, ruler, playhead ---------- */
const Clip = memo(function Clip({item, pps, selected, dragging, shifted, onDown, onMove, onUp, onKeyDown, h}) {
  const {clip, media} = item, w = Math.max(4, item.dur * pps);
  const n = quantizeFrames(Math.ceil((media?.duration || 3) * pps / 40));
  const bg = media?.url ? stripUrl(media.url, n, 96) : null;
  return (
    <div className={clsx('clip', selected && 'is-selected', dragging && 'is-dragging', shifted && 'is-shifted')}
      style={{transform: `translateX(${item.x}px)`, width: w, zIndex: dragging ? 5 : selected ? 2 : 1}} role="option" aria-selected={selected} tabIndex={0}
      aria-label={`${media?.name || 'Missing clip'}, ${item.dur.toFixed(2)} seconds`} data-clip={clip.id}
      onPointerDown={e => onDown(e, item, 'move')} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={e => onKeyDown(e, item)}>
      <div className="clip-film" style={bg ? {backgroundImage: `url(${bg})`, backgroundSize: `${(media.duration || 3) * pps}px 100%`, backgroundPosition: `${-clip.start * pps}px 0`} : undefined} />
      <div className="clip-meta"><b>{item.index + 1}</b><span>{media?.name || 'Missing clip'}</span>{w > 120 && <em>{item.dur.toFixed(1)}s</em>}</div>
      <span className="clip-handle left" onPointerDown={e => onDown(e, item, 'left')} onPointerMove={onMove} onPointerUp={onUp}><i /></span>
      <span className="clip-handle right" onPointerDown={e => onDown(e, item, 'right')} onPointerMove={onMove} onPointerUp={onUp}><i /></span>
    </div>
  );
});

export function SequenceTimeline({items, total, extent, audio, pps, setPps, selectedId, onSelect, onSeek, onTrim, onReorder, onAdd, disabled, snap, fitPps}) {
  const scroller = useRef(null), drag = useRef(null), width = useWidth(scroller);
  const [live, setLive] = useState(null);

  // Lay out clips, applying the in-progress trim or reorder so the timeline reflows under the pointer.
  const laid = useMemo(() => {
    let order = items.map((it, i) => ({...it, index: i}));
    let dragged = null;
    if (live?.kind === 'move') {
      const me = order.find(o => o.clip.id === live.id), others = order.filter(o => o !== me);
      let x = 0; const centers = others.map(o => { const c = x + o.dur / 2; x += o.dur; return c; });
      const myCenter = me.offset + live.dt + me.dur / 2;
      const target = centers.filter(c => c < myCenter).length;
      others.splice(target, 0, me); order = others; dragged = {id: me.clip.id, target, x: Math.max(0, me.offset + live.dt)};
    }
    let x = 0;
    const out = order.map((o, i) => {
      let dur = o.dur;
      if (live && live.id === o.clip.id && live.kind !== 'move') dur = live.end - live.start;
      const item = {...o, dur, index: i, x: dragged?.id === o.clip.id ? dragged.x * pps : x * pps, shifted: dragged && dragged.id !== o.clip.id};
      if (live && live.id === o.clip.id && live.kind !== 'move') item.clip = {...o.clip, start: live.start, end: live.end};
      x += dur; return item;
    });
    return {list: out, target: dragged?.target, total: x};
  }, [items, live, pps]);
  const contentWidth = Math.max(width, Math.max(extent, laid.total) * pps + 160);

  const timeAt = ev => { const r = scroller.current.getBoundingClientRect(); return (ev.clientX - r.left + scroller.current.scrollLeft) / pps; };
  const snapTime = (t, ev) => {
    if (!snap || ev.altKey) return t;
    const points = [0, ...laid.list.map(i => i.x / pps + i.dur), total];
    const near = points.find(p => Math.abs(p - t) * pps < 7);
    return near ?? t;
  };
  const scrub = ev => {
    if (ev.button !== 0) return;
    ev.currentTarget.setPointerCapture(ev.pointerId); drag.current = {kind: 'scrub'}; onSeek(clamp(snapTime(timeAt(ev), ev), 0, total));
  };
  const scrubMove = ev => { if (drag.current?.kind === 'scrub') onSeek(clamp(snapTime(timeAt(ev), ev), 0, total)); };
  const scrubUp = () => { if (drag.current?.kind === 'scrub') drag.current = null; };

  const onDown = useCallback((ev, item, kind) => {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    ev.currentTarget.setPointerCapture(ev.pointerId);
    onSelect(item.clip.id);
    drag.current = {kind, id: item.clip.id, x0: ev.clientX, moved: false, item};
    if (kind !== 'move') ev.preventDefault();
  }, [onSelect]);
  const onMove = useCallback(ev => {
    const d = drag.current; if (!d || d.kind === 'scrub') return;
    const dx = ev.clientX - d.x0; if (Math.abs(dx) > 3) d.moved = true; if (!d.moved) return;
    const {clip, media} = d.item, dt = dx / pps;
    if (d.kind === 'move') setLive({kind: 'move', id: d.id, dt});
    else if (d.kind === 'left') { const start = clamp(frame(clip.start + dt), 0, clip.end - 1 / FPS); setLive({kind: 'left', id: d.id, start, end: clip.end}); }
    else { const end = clamp(frame(clip.end + dt), clip.start + 1 / FPS, floorFrame(media?.duration ?? clip.end)); setLive({kind: 'right', id: d.id, start: clip.start, end}); }
  }, [pps]);
  const onUp = useCallback(ev => {
    const d = drag.current; if (!d || d.kind === 'scrub') return;
    drag.current = null;
    const result = live; setLive(null);
    if (!d.moved || !result) {
      if (d.kind === 'move') { const r = ev.currentTarget.getBoundingClientRect(); onSeek(d.item.offset + clamp((ev.clientX - r.left) / pps, 0, d.item.dur)); }
      return;
    }
    if (result.kind === 'move') onReorder(result.id, laid.target);
    else onTrim(result.id, {start: result.start, end: result.end});
  }, [live, laid.target, pps, onSeek, onReorder, onTrim]);
  const onKeyDown = useCallback((ev, item) => {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onSelect(item.clip.id); onSeek(item.offset); }
  }, [onSelect, onSeek]);

  // Ctrl/⌘ + wheel zooms around the pointer; a plain wheel scrolls sideways.
  useEffect(() => {
    const el = scroller.current; if (!el) return;
    const wheel = ev => {
      if (ev.ctrlKey || ev.metaKey) {
        ev.preventDefault();
        const r = el.getBoundingClientRect(), anchor = (ev.clientX - r.left + el.scrollLeft) / pps;
        const next = clamp(pps * Math.exp(-ev.deltaY * 0.01), Math.min(fitPps, 8), 600);
        setPps(next);
        requestAnimationFrame(() => { el.scrollLeft = anchor * next - (ev.clientX - r.left); });
      } else if (Math.abs(ev.deltaY) > Math.abs(ev.deltaX) && el.scrollWidth > el.clientWidth) { el.scrollLeft += ev.deltaY; ev.preventDefault(); }
    };
    el.addEventListener('wheel', wheel, {passive: false}); return () => el.removeEventListener('wheel', wheel);
  }, [pps, fitPps, setPps]);

  // Follow the playhead while playing.
  useEffect(() => usePlayhead.subscribe((s, prev) => {
    const el = scroller.current; if (!el || !s.playing || s.cursor === prev.cursor) return;
    const x = s.cursor * pps;
    if (x < el.scrollLeft + 24 || x > el.scrollLeft + el.clientWidth - 60) el.scrollLeft = Math.max(0, x - 80);
  }), [pps]);

  const peaks = useMemo(() => {
    if (!audio?.peaks?.length || !audio.seconds) return null;
    const n = audio.peaks.length, from = Math.floor(clamp(audio.start / audio.seconds, 0, 1) * n), slice = audio.peaks.slice(from);
    if (slice.length < 2) return null;
    const up = slice.map((p, i) => `${i},${50 - Math.max(1, p * 46)}`), down = slice.map((p, i) => `${i},${50 + Math.max(1, p * 46)}`).reverse();
    return {d: `M0,50 L${up.join(' L')} L${slice.length - 1},50 L${down.join(' L')} Z`, n: slice.length};
  }, [audio?.peaks, audio?.start, audio?.seconds]);
  const audioLen = audio ? Math.max(0, audio.seconds - audio.start) : 0;
  const usesReel = audio && ['reel', 'mix'].includes(audio.mode);

  return (
    <div className="seq" data-disabled={disabled || undefined}>
      <div className="seq-heads" aria-hidden="true">
        <div className="seq-head ruler-head" />
        <div className="seq-head vid"><b>Video</b><span>{laid.list.length} clip{laid.list.length === 1 ? '' : 's'}</span></div>
        <div className="seq-head aud"><b>Soundtrack</b><span>{audio?.mode === 'silent' ? 'Muted' : usesReel ? 'Reel' : 'Clips'}</span></div>
      </div>
      <div className="seq-scroll" ref={scroller}>
        <div className="seq-content" style={{width: contentWidth}}>
          <Ruler pps={pps} extent={contentWidth / pps} onPointerDown={scrub} onPointerMove={scrubMove} onPointerUp={scrubUp} />
          <div className="lane lane-video" role="listbox" aria-label="Video clips" onPointerDown={scrub} onPointerMove={scrubMove} onPointerUp={scrubUp}>
            {laid.list.map(item => (
              <Clip key={item.clip.id} item={item} pps={pps} selected={selectedId === item.clip.id} dragging={live?.kind === 'move' && live.id === item.clip.id} shifted={item.shifted}
                onDown={onDown} onMove={onMove} onUp={onUp} onKeyDown={onKeyDown} />
            ))}
            {!disabled && <button type="button" className="clip-add" style={{transform: `translateX(${laid.total * pps + 8}px)`}} onPointerDown={e => e.stopPropagation()} onClick={onAdd} aria-label="Add clip"><Plus size={16} /><span>{laid.list.length ? '' : 'Add clips'}</span></button>}
          </div>
          <div className={clsx('lane lane-audio', audio?.mode === 'silent' && 'is-muted')} onPointerDown={scrub} onPointerMove={scrubMove} onPointerUp={scrubUp}>
            {usesReel && audioLen > 0 && (
              <div className="wave" style={{width: audioLen * pps}}>
                {peaks && <svg viewBox={`0 0 ${peaks.n - 1} 100`} preserveAspectRatio="none" aria-hidden="true"><path d={peaks.d} /></svg>}
                {!peaks && <span className="wave-label">Original reel audio</span>}
                {audio.keepFull && audioLen > total + 0.04 && <div className="wave-gap" style={{left: total * pps, width: (audioLen - total) * pps}} title="Soundtrack extends past the last clip"><span>Needs {(audioLen - total).toFixed(1)}s more footage</span></div>}
                {audio.start > 0 && <span className="wave-offset">Starts at {audio.start.toFixed(2)}s of the reel</span>}
              </div>
            )}
            {audio?.mode === 'clips' && <div className="wave clips-audio" style={{width: total * pps}}><span className="wave-label">Audio from each clip</span></div>}
            {audio?.mode === 'silent' && <span className="lane-note">Silent output</span>}
            {!usesReel && audio?.mode === 'mix' && null}
          </div>
          <Playhead pps={pps} />
        </div>
      </div>
    </div>
  );
}
