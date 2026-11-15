import clsx from 'clsx';
import {ChevronLeft, ChevronRight, Copy, Magnet, Maximize2, Pause, Play, Plus, Redo2, Scissors, SkipBack, SkipForward, Trash2, Undo2, ZoomIn, ZoomOut} from 'lucide-react';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {saveDownload} from '../api.js';
import {ClipLibrary} from '../components/ClipLibrary.jsx';
import {NumField} from '../components/NumField.jsx';
import {VideoPlayer} from '../components/Player.jsx';
import {PrimaryFooter} from '../components/Shell.jsx';
import {SequenceTimeline, useWidth} from '../components/Timeline.jsx';
import {Button, Callout, Disclosure, Field, IconButton, Menu, MenuItem, Segmented, Spinner, SwitchRow, Tip} from '../components/ui.jsx';
import {history, mutate, renderFinal, resolveSource, save, seedEntry, select, useEntry} from '../editStore.js';
import {FPS, clamp, clock, floorFrame, frame, uid} from '../lib.js';
import {usePlayhead} from '../playhead.js';
import {useJob, useStudio} from '../store.js';
import {useSequencePlayer} from '../useSequencePlayer.js';
import {StageHeader, Workspace} from './common.jsx';

const waveCache = new Map();
const RATES = [0.5, 0.75, 1, 1.5, 2];
const AUDIO_MODES = [
  ['reel', 'Original reel audio', 'The complete downloaded soundtrack'],
  ['clips', 'Clip audio', 'Sound from each clip'],
  ['mix', 'Reel + clip audio', 'Both mixed together'],
  ['silent', 'Silent', 'No audio in the render'],
];

function Timecode() {
  const cursor = usePlayhead(s => s.cursor);
  return <>{clock(cursor, true)}</>;
}

export default function EditStage() {
  const job = useJob(), data = useStudio(s => s.data), sending = useStudio(s => s.sending), uploadCount = useStudio(s => s.uploadCount), connected = useStudio(s => s.connected);
  const entry = useEntry(job);
  const videoRef = useRef(null), musicRef = useRef(null), timelineHost = useRef(null);
  const [mode, setMode] = useState('sequence'), [zoom, setZoom] = useState(null), [snap, setSnap] = useState(true), [rate, setRate] = useState(1), [library, setLibrary] = useState(false), [peaks, setPeaks] = useState(null);
  const hostWidth = useWidth(timelineHost);

  useEffect(() => { if (job) seedEntry(job); }, [job?.id, job?.media.hook, job?.media.generated, entry?.id]); // eslint-disable-line
  useEffect(() => { const src = job?.media.audio?.split('?')[0]; if (!src) { setPeaks(null); return; }
    if (waveCache.has(src)) { setPeaks(waveCache.get(src)); return; }
    fetch(`/api/waveform?src=${encodeURIComponent(src)}&buckets=800`).then(r => r.ok ? r.json() : null).then(w => { if (w) { waveCache.set(src, w); setPeaks(w); } }).catch(() => {}); }, [job?.media.audio]);

  const doc = entry?.doc;
  const busy = Boolean(job?.busy || sending || uploadCount || !connected);
  const usesReel = doc && ['reel', 'mix'].includes(doc.audio_mode), usesClips = doc && ['clips', 'mix'].includes(doc.audio_mode);

  const items = useMemo(() => {
    if (!doc) return [];
    let offset = 0;
    return doc.clips.map(clip => {
      const media = resolveSource(clip.source, data), dur = clip.end - clip.start, item = {id: clip.id, clip, media, url: media?.url, start: clip.start, end: clip.end, volume: usesClips ? Math.min(1, clip.volume) : 0, offset, dur};
      offset += dur; return item;
    });
  }, [doc, data, usesClips]);
  const total = items.reduce((n, i) => n + i.dur, 0);
  const playable = useMemo(() => items.filter(i => i.media), [items]);
  const audio = useMemo(() => ({url: job?.media.audio, start: doc?.audio_start || 0, seconds: Number(job?.audio_seconds || 0), gain: doc?.audio_gain ?? 1, active: Boolean(usesReel && job?.media.audio && mode === 'sequence'), keepFull: doc?.keep_full_audio, mode: doc?.audio_mode, peaks: peaks?.peaks}), [job?.media.audio, job?.audio_seconds, doc?.audio_start, doc?.audio_gain, doc?.keep_full_audio, doc?.audio_mode, usesReel, mode, peaks]);
  const player = useSequencePlayer({items: mode === 'sequence' ? playable : [], audio, videoRef, musicRef, rate});

  const audioLen = usesReel ? Math.max(0, audio.seconds - audio.start) : 0;
  const extent = Math.max(3, total, audioLen);
  const fit = clamp((hostWidth - 84 - 120) / extent, 8, 240);
  const pps = zoom ?? fit;
  const selected = doc?.clips.find(c => c.id === entry?.selected), selectedItem = items.find(i => i.id === entry?.selected);
  const gap = usesReel && doc?.keep_full_audio ? Math.max(0, audioLen - total) : 0;
  const rendered = Boolean(entry && !entry.dirty && !entry.error && job.edit_status === 'ready' && job.rendered_edit_version === entry.version && job.media.assembly);
  const rendering = job?.edit_status === 'rendering';

  // Switch to the finished render when it lands.
  const prevStatus = useRef(job?.edit_status);
  useEffect(() => { if (prevStatus.current === 'rendering' && job?.edit_status === 'ready') { useStudio.getState().toast('Final video is ready.', 'success'); setMode('rendered'); } prevStatus.current = job?.edit_status; }, [job?.edit_status]);

  const edit = useCallback(fn => { if (busy || !job) return; player.pause(); mutate(job.id, fn); }, [busy, job, player]);
  const add = useCallback(source => { const media = resolveSource(source, useStudio.getState().data); if (!media) return; if (entry.doc.clips.length >= 30) { useStudio.getState().toast('Use up to 30 clips in one sequence.', 'error'); return; }
    const id = uid(); edit(d => { d.clips.push({id, source, start: 0, end: floorFrame(media.duration), volume: 1}); }); select(job.id, id); }, [edit, entry, job]);
  const trim = useCallback((id, {start, end}) => edit(d => { const c = d.clips.find(x => x.id === id); if (c) { c.start = start; c.end = end; } }), [edit]);
  const reorder = useCallback((id, to) => edit(d => { const i = d.clips.findIndex(c => c.id === id); if (i < 0) return; const [c] = d.clips.splice(i, 1); d.clips.splice(clamp(to, 0, d.clips.length), 0, c); }), [edit]);
  const remove = useCallback(() => { if (entry?.selected) edit(d => { d.clips = d.clips.filter(c => c.id !== entry.selected); }); }, [edit, entry?.selected]);
  const split = useCallback(() => {
    const it = items.find(i => i.id === entry?.selected); if (!it) return;
    const cursor = player.cursorRef.current, point = frame(it.clip.start + cursor - it.offset);
    if (point <= it.clip.start + 0.001 || point >= it.clip.end - 0.001) { useStudio.getState().toast('Move the playhead inside the selected clip to split it.'); return; }
    const nid = uid();
    edit(d => { const c = d.clips.find(x => x.id === it.id), next = {...JSON.parse(JSON.stringify(c)), id: nid, start: point}; c.end = point; d.clips.splice(d.clips.indexOf(c) + 1, 0, next); });
    select(job.id, nid);
  }, [items, entry?.selected, player, edit, job]);
  const duplicate = useCallback(() => { const it = items.find(i => i.id === entry?.selected); if (!it) return; const nid = uid(); edit(d => { const c = d.clips.find(x => x.id === it.id); d.clips.splice(d.clips.indexOf(c) + 1, 0, {...JSON.parse(JSON.stringify(c)), id: nid}); }); select(job.id, nid); }, [items, entry?.selected, edit, job]);
  const nudge = dir => edit(d => { const i = d.clips.findIndex(c => c.id === entry.selected), t = i + dir; if (i >= 0 && t >= 0 && t < d.clips.length) [d.clips[i], d.clips[t]] = [d.clips[t], d.clips[i]]; });
  const setDoc = (key, value) => edit(d => { d[key] = value; });
  const choose = useCallback(id => select(job.id, id), [job?.id]);
  const seekTo = useCallback(t => player.seek(t, {keepPlaying: false}), [player]);
  const zoomBy = f => setZoom(clamp(pps * f, 8, 600));
  const jump = dir => { const edges = [0, ...items.map(i => i.offset + i.dur)], c = player.cursorRef.current; const t = dir > 0 ? edges.find(e => e > c + 0.01) : [...edges].reverse().find(e => e < c - 0.01); player.seek(t ?? (dir > 0 ? total : 0), {keepPlaying: false}); };

  // Keyboard: the whole editor is drivable without a mouse.
  useEffect(() => {
    const onKey = e => {
      if (e.target.closest?.('input,textarea,select,[contenteditable],[role=dialog],[role=menu],[role=slider]')) return;
      const meta = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
      if (k === ' ' || (k === 'k' && !meta)) { e.preventDefault(); player.toggle(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); player.step(e.shiftKey ? -FPS : -1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); player.step(e.shiftKey ? FPS : 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); jump(-1); } else if (e.key === 'ArrowDown') { e.preventDefault(); jump(1); }
      else if (e.key === 'Home') { e.preventDefault(); seekTo(0); } else if (e.key === 'End') { e.preventDefault(); seekTo(total); }
      else if (k === 's' && !meta) { e.preventDefault(); split(); }
      else if (k === 'delete' || k === 'backspace') { e.preventDefault(); remove(); }
      else if (meta && k === 'z') { e.preventDefault(); if (!busy) history(job.id, e.shiftKey ? 'redo' : 'undo'); }
      else if (meta && k === 'y') { e.preventDefault(); if (!busy) history(job.id, 'redo'); }
      else if (meta && k === 'd') { e.preventDefault(); duplicate(); }
      else if (k === '=' || k === '+') zoomBy(1.25); else if (k === '-') zoomBy(0.8); else if (k === '0') setZoom(null);
      else if (k === 'n') setSnap(v => !v);
      else if (e.key === '[') nudge(-1); else if (e.key === ']') nudge(1);
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });

  if (!job || !entry) return <div className="canvas-empty"><h2>Prepare a reference first</h2></div>;
  const hasClips = doc.clips.length > 0;
  const status = entry.saving ? 'Saving…' : entry.error ? 'Unsaved changes' : entry.dirty ? 'Unsaved changes' : 'Saved locally';
  const count = source => doc.clips.filter(c => JSON.stringify([c.source.kind, c.source.id, c.source.media]) === JSON.stringify([source.kind, source.id, source.media])).length;

  const stage = (
    <>
      <StageHeader title="Edit" meta="Trim, arrange and stitch into one finished video">
        <Segmented size="sm" value={mode} onChange={setMode} label="Preview" options={[{value: 'sequence', label: 'Live sequence'}, {value: 'rendered', label: rendered ? 'Rendered final' : 'Previous render', disabled: !job.media.assembly}]} />
      </StageHeader>
      <div className="canvas edit-canvas">
        {mode === 'rendered' && job.media.assembly ? <VideoPlayer src={job.media.assembly} label="Rendered final video" caption={<><b>{rendered ? 'Rendered final' : 'Previous render'}</b><span>1080×1920</span></>} />
          : hasClips ? <SeqPreview videoRef={videoRef} player={player} total={total} rate={rate} setRate={setRate} jump={jump} />
          : <div className="canvas-empty"><h2>Build your final sequence</h2><p>Add a reaction, demo or another video. Trim and arrange them below.</p><Button variant="primary" icon={Plus} onClick={() => setLibrary(true)}>Add clips</Button></div>}
        <audio ref={musicRef} preload="metadata" hidden />
      </div>
      <section className="seq-panel" aria-label="Final edit timeline" ref={timelineHost}>
        <div className="seq-toolbar" role="toolbar" aria-label="Edit tools">
          <IconButton label="Undo" shortcut="⌘Z" icon={Undo2} disabled={busy || !entry.undo.length} onClick={() => history(job.id, 'undo')} />
          <IconButton label="Redo" shortcut="⇧⌘Z" icon={Redo2} disabled={busy || !entry.redo.length} onClick={() => history(job.id, 'redo')} />
          <span className="sep" />
          <IconButton label="Split at playhead" shortcut="S" icon={Scissors} disabled={busy || !selected} onClick={split} />
          <IconButton label="Duplicate clip" shortcut="⌘D" icon={Copy} disabled={busy || !selected} onClick={duplicate} />
          <IconButton label="Delete clip" shortcut="⌫" icon={Trash2} disabled={busy || !selected} onClick={remove} />
          <span className="sep" />
          <Button size="sm" icon={Plus} disabled={busy} onClick={() => setLibrary(true)}>Add clips</Button>
          <span className="grow" />
          <span className={clsx('save-pill', (entry.dirty || entry.error) && 'dirty')}>{entry.saving && <Spinner size={11} />}{status}</span>
          <span className="sep" />
          <IconButton label={snap ? 'Snapping on' : 'Snapping off'} shortcut="N" icon={Magnet} active={snap} onClick={() => setSnap(v => !v)} />
          <IconButton label="Zoom out" shortcut="−" icon={ZoomOut} onClick={() => zoomBy(0.8)} />
          <input className="zoom" type="range" min={Math.log(8)} max={Math.log(600)} step={0.01} value={Math.log(pps)} onChange={e => setZoom(Math.exp(Number(e.target.value)))} aria-label="Timeline zoom" />
          <IconButton label="Zoom in" shortcut="+" icon={ZoomIn} onClick={() => zoomBy(1.25)} />
          <IconButton label="Fit to window" shortcut="0" icon={Maximize2} onClick={() => setZoom(null)} />
        </div>
        <SequenceTimeline items={items} total={total} extent={extent} audio={audio} pps={pps} setPps={setZoom} fitPps={fit} selectedId={entry.selected} onSelect={choose}
          onSeek={seekTo} onTrim={trim} onReorder={reorder} onAdd={() => setLibrary(true)} disabled={busy} snap={snap} />
      </section>
      <ClipLibrary open={library} onOpenChange={setLibrary} onAdd={add} counts={count} />
    </>
  );

  const clipMissing = items.some(i => !i.media);
  const inspector = (
    <div className="panel">
      <h2>Edit the sequence</h2>
      <p className="panel-intro">Drag clip edges to trim, drag clips to reorder, <kbd className="kbd">S</kbd> splits at the playhead.</p>
      {clipMissing && <Callout tone="error" title="A clip is missing">One of the clips can't be found. Remove it or upload it again.</Callout>}
      {selected && selectedItem ? (
        <section className="clip-card" aria-label="Selected clip">
          <header><b title={selectedItem.media?.name}>{selectedItem.media?.name || 'Missing clip'}</b><span>Clip {doc.clips.indexOf(selected) + 1} of {doc.clips.length}</span></header>
          <div className="pair">
            <Field label="In" htmlFor="c-in"><NumField id="c-in" value={selected.start} min={0} max={selected.end - 1 / FPS} step={1 / FPS} disabled={busy} onCommit={v => trim(selected.id, {start: clamp(frame(v), 0, selected.end - 1 / FPS), end: selected.end})} /></Field>
            <Field label="Out" htmlFor="c-out"><NumField id="c-out" value={selected.end} min={selected.start + 1 / FPS} max={selectedItem.media?.duration} step={1 / FPS} disabled={busy} onCommit={v => trim(selected.id, {start: selected.start, end: clamp(frame(v), selected.start + 1 / FPS, floorFrame(selectedItem.media?.duration ?? selected.end))})} /></Field>
          </div>
          <p className="hint">Duration {(selected.end - selected.start).toFixed(2)}s of {Number(selectedItem.media?.duration || 0).toFixed(2)}s source</p>
          <Field label="Clip volume" aside={Math.round(selected.volume * 100) + '%'} htmlFor="c-vol" hint={usesClips ? undefined : 'Clip audio is off — choose “Clip audio” below to hear it.'}>
            <input id="c-vol" type="range" min={0} max={200} step={5} value={Math.round(selected.volume * 100)} disabled={busy} onChange={e => edit(d => { d.clips.find(c => c.id === selected.id).volume = Number(e.target.value) / 100; })} />
          </Field>
          <div className="row-actions">
            <Button size="sm" icon={ChevronLeft} disabled={busy || doc.clips.indexOf(selected) === 0} onClick={() => nudge(-1)}>Earlier</Button>
            <Button size="sm" icon={ChevronRight} disabled={busy || doc.clips.indexOf(selected) === doc.clips.length - 1} onClick={() => nudge(1)}>Later</Button>
            <Button size="sm" variant="ghost" className="danger" icon={Trash2} disabled={busy} onClick={remove}>Remove</Button>
          </div>
        </section>
      ) : <p className="empty-note">{hasClips ? 'Select a clip on the timeline to trim it precisely.' : 'Add your first clip to start editing.'}</p>}

      <Disclosure title="Soundtrack" meta={AUDIO_MODES.find(m => m[0] === doc.audio_mode)?.[1]} defaultOpen>
        <div className="radio-list" role="radiogroup" aria-label="Audio source">
          {AUDIO_MODES.filter(m => job.source_has_audio || !['reel', 'mix'].includes(m[0])).map(([v, label, hint]) => (
            <label key={v} className={clsx('radio', doc.audio_mode === v && 'on')}><input type="radio" name="audio-mode" checked={doc.audio_mode === v} disabled={busy} onChange={() => setDoc('audio_mode', v)} /><span><b>{label}</b><small>{hint}</small></span></label>
          ))}
        </div>
        {usesReel && <>
          <Field label="Reel volume" aside={Math.round(doc.audio_gain * 100) + '%'} htmlFor="r-vol" hint="Preview is capped at 100%; the render applies your full gain.">
            <input id="r-vol" type="range" min={0} max={200} step={5} value={Math.round(doc.audio_gain * 100)} disabled={busy} onChange={e => setDoc('audio_gain', Number(e.target.value) / 100)} /></Field>
          <Field label="Audio start" htmlFor="r-start" hint="Where in the reel the soundtrack begins."><NumField id="r-start" value={doc.audio_start} min={0} step={1 / FPS} disabled={busy} onCommit={v => setDoc('audio_start', Math.max(0, v))} /></Field>
          <SwitchRow id="keep-full-audio" title="Keep full soundtrack" description="Requires enough footage to cover all of the audio." checked={doc.keep_full_audio} disabled={busy} onChange={v => setDoc('keep_full_audio', v)} />
          {gap > 0.04 && <Callout tone="warn" title={`${gap.toFixed(2)}s more footage needed`} actions={<><Button size="sm" onClick={() => setLibrary(true)}>Add footage</Button><Button size="sm" onClick={() => setDoc('keep_full_audio', false)}>Trim audio to edit</Button></>}>The soundtrack is longer than your clips. The edit never freezes a frame to fill the gap.</Callout>}
        </>}
      </Disclosure>
      {(entry.error || job.edit_error) && <Callout tone="error" title="Edit needs attention">{entry.error || job.edit_error}</Callout>}
      <details className="disclosure shortcuts"><summary><span>Keyboard shortcuts</span></summary><div className="disclosure-body"><Shortcuts /></div></details>
    </div>
  );

  const footer = (
    <PrimaryFooter custom={{
      label: rendering ? 'Rendering final video…' : rendered ? 'Download final video' : 'Export final video',
      progress: rendering ? 'Joining your clips and mixing the soundtrack locally.' : gap > 0.04 ? `Add ${gap.toFixed(2)}s of footage to cover the full soundtrack.` : hasClips ? `${total.toFixed(1)}s final video · originals stay unchanged.` : 'Add clips to build your video.',
      note: '1080 × 1920 · 30 fps · rendered locally', disabled: !hasClips || busy || gap > 0.04 || rendering, busy: rendering || sending,
      onClick: () => rendered ? saveDownload(job.media.assembly) : renderFinal(job.id),
    }} />
  );
  return <Workspace stage={stage} inspector={inspector} footer={footer} className="is-edit" />;
}

function SeqPreview({videoRef, player, total, rate, setRate, jump}) {
  const playing = usePlayhead(s => s.playing), cursor = usePlayhead(s => s.cursor);
  return (
    <div className="player seq-player">
      <div className="player-frame" tabIndex={-1}>
        <video ref={videoRef} playsInline preload="auto" aria-label="Sequence preview" onClick={player.toggle} {...player.videoProps} />
        {!playing && <button type="button" className="player-big" onClick={player.toggle} aria-label="Play"><Play size={26} fill="currentColor" /></button>}
      </div>
      <div className="player-bar">
        <input type="range" className="scrub" min={0} max={Math.max(total, 1 / FPS)} step={1 / FPS} value={Math.min(cursor, total)} aria-label="Sequence playhead" style={{'--p': total ? (cursor / total * 100) + '%' : '0%'}} onChange={e => player.seek(Number(e.target.value), {keepPlaying: false})} />
        <div className="player-row">
          <IconButton label="Previous clip" shortcut="↑" icon={SkipBack} onClick={() => jump(-1)} />
          <IconButton label={playing ? 'Pause' : 'Play'} shortcut="Space" icon={playing ? Pause : Play} onClick={player.toggle} />
          <IconButton label="Next clip" shortcut="↓" icon={SkipForward} onClick={() => jump(1)} />
          <span className="timecode"><Timecode /><i> / {clock(total, true)}</i></span>
          <span className="grow" />
          <IconButton label="Previous frame" shortcut="←" icon={ChevronLeft} onClick={() => player.step(-1)} />
          <IconButton label="Next frame" shortcut="→" icon={ChevronRight} onClick={() => player.step(1)} />
          <Menu side="top" trigger={<button type="button" className="rate-btn" aria-label="Playback speed">{rate}×</button>}>
            {RATES.map(r => <MenuItem key={r} onSelect={() => setRate(r)} hint={r === rate ? '✓' : ''}>{r}×</MenuItem>)}
          </Menu>
        </div>
      </div>
    </div>
  );
}

export function Shortcuts() {
  const rows = [['Play / pause', 'Space'], ['Step frame', '← →'], ['Step 1 second', '⇧ ← →'], ['Previous / next cut', '↑ ↓'], ['Split at playhead', 'S'], ['Delete clip', '⌫'], ['Duplicate clip', '⌘D'], ['Undo / redo', '⌘Z / ⇧⌘Z'], ['Zoom', '+ − 0 or ⌘ + scroll'], ['Snapping', 'N'], ['Move clip', '[ ]']];
  return <dl className="shortcut-list">{rows.map(([a, k]) => <div key={a}><dt>{a}</dt><dd>{k.split(' ').map((x, i) => /^[+−/or]+$/.test(x) && x.length < 3 ? <span key={i}>{x}</span> : <kbd key={i} className="kbd">{x}</kbd>)}</dd></div>)}</dl>;
}
