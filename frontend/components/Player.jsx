import clsx from 'clsx';
import {ChevronLeft, ChevronRight, Maximize, Pause, Play, Volume2, VolumeX} from 'lucide-react';
import {useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef} from 'react';
import {FPS, clock} from '../lib.js';
import {IconButton, Menu, MenuItem, Button} from './ui.jsx';

const RATES = [0.25, 0.5, 0.75, 1, 1.5, 2];

export const VideoPlayer = forwardRef(function VideoPlayer({src, label, caption, onTime, onReady, className, muted: forcedMute, loop, children}, ref) {
  const video = useRef(null), frame = useRef(null);
  const [playing, setPlaying] = useState(false), [time, setTime] = useState(0), [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false), [rate, setRate] = useState(1), [failed, setFailed] = useState(false), [ready, setReady] = useState(false);

  useImperativeHandle(ref, () => ({
    video: video.current,
    play: () => video.current?.play().catch(() => {}),
    pause: () => video.current?.pause(),
    seek: t => { const v = video.current; if (v) { v.currentTime = Math.max(0, Math.min(v.duration || t, t)); setTime(v.currentTime); } },
    get currentTime() { return video.current?.currentTime || 0; },
  }), []);

  useEffect(() => { setFailed(false); setReady(false); setTime(0); setPlaying(false); }, [src]);
  useEffect(() => { if (video.current) video.current.playbackRate = rate; }, [rate, src]);

  // Smooth scrubber while playing: timeupdate alone is too coarse for frame-level review.
  useEffect(() => {
    if (!playing) return;
    let id; const tick = () => { const t = video.current?.currentTime || 0; setTime(t); onTime?.(t); id = requestAnimationFrame(tick); };
    id = requestAnimationFrame(tick); return () => cancelAnimationFrame(id);
  }, [playing, onTime]);

  const toggle = useCallback(() => { const v = video.current; if (!v) return; v.paused ? v.play().catch(() => {}) : v.pause(); }, []);
  const step = useCallback(n => { const v = video.current; if (!v) return; v.pause(); v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + n / FPS)); setTime(v.currentTime); onTime?.(v.currentTime); }, [onTime]);
  const seek = t => { const v = video.current; v.currentTime = t; setTime(t); onTime?.(t); };

  const onKey = e => {
    if (e.target.closest('input,select,textarea')) return;
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'k') { e.preventDefault(); toggle(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); step(e.shiftKey ? -FPS : -1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); step(e.shiftKey ? FPS : 1); }
    else if (k === 'j') setRate(r => RATES[Math.max(0, RATES.indexOf(r) - 1)] ?? 1);
    else if (k === 'l') setRate(r => RATES[Math.min(RATES.length - 1, RATES.indexOf(r) + 1)] ?? 1);
    else if (k === 'm') setMuted(m => !m);
    else if (k === 'f') frame.current?.requestFullscreen?.();
  };

  return (
    <div className={clsx('player', className)} onKeyDown={onKey}>
      {caption && <div className="player-caption">{caption}</div>}
      <div className="player-frame" ref={frame} tabIndex={0} aria-label={label}>
        {src && <video ref={video} src={src} playsInline preload="metadata" loop={loop} muted={forcedMute || muted} aria-label={label}
          onClick={toggle} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
          onLoadedMetadata={e => { setDuration(e.currentTarget.duration); setReady(true); e.currentTarget.playbackRate = rate; onReady?.(e.currentTarget); }}
          onTimeUpdate={e => { if (!playing) setTime(e.currentTarget.currentTime); }} onError={() => setFailed(true)} onSeeked={e => { setTime(e.currentTarget.currentTime); onTime?.(e.currentTarget.currentTime); }} />}
        {!ready && !failed && <div className="player-loading skeleton" aria-hidden="true" />}
        {failed && <div className="player-error">This video can't be played in the browser.</div>}
        {ready && !playing && <button type="button" className="player-big" onClick={toggle} aria-label="Play"><Play size={26} fill="currentColor" /></button>}
        {children}
      </div>
      <div className="player-bar">
        <input type="range" className="scrub" min={0} max={duration || 1} step={1 / 600} value={Math.min(time, duration || 1)} aria-label="Seek"
          style={{'--p': duration ? (time / duration * 100) + '%' : '0%'}} onChange={e => seek(Number(e.target.value))} disabled={!ready} />
        <div className="player-row">
          <IconButton label={playing ? 'Pause' : 'Play'} shortcut="Space" icon={playing ? Pause : Play} onClick={toggle} disabled={!ready} />
          <span className="timecode">{clock(time, true)}<i> / {clock(duration, true)}</i></span>
          <span className="grow" />
          <IconButton label="Previous frame" shortcut="←" icon={ChevronLeft} onClick={() => step(-1)} disabled={!ready} />
          <IconButton label="Next frame" shortcut="→" icon={ChevronRight} onClick={() => step(1)} disabled={!ready} />
          <Menu side="top" trigger={<button type="button" className="rate-btn" aria-label="Playback speed">{rate}×</button>}>
            {RATES.map(r => <MenuItem key={r} onSelect={() => setRate(r)} hint={r === rate ? '✓' : ''}>{r}×</MenuItem>)}
          </Menu>
          {!forcedMute && <IconButton label={muted ? 'Unmute' : 'Mute'} shortcut="M" icon={muted ? VolumeX : Volume2} onClick={() => setMuted(m => !m)} />}
          <IconButton label="Full screen" shortcut="F" icon={Maximize} onClick={() => frame.current?.requestFullscreen?.()} />
        </div>
      </div>
    </div>
  );
});

// Two players compared with one transport. Useful for reference vs. generated motion.
export function CompareTransport({leftRef, rightRef}) {
  const [playing, setPlaying] = useState(false);
  const both = async () => {
    const a = leftRef.current, b = rightRef.current;
    if (!a || !b) return;
    if (playing) { a.pause(); b.pause(); setPlaying(false); return; }
    a.seek(0); b.seek(0); setPlaying(true);
    await Promise.all([a.play(), b.play()]);
    const done = () => setPlaying(false);
    a.video?.addEventListener('ended', done, {once: true});
  };
  return <Button size="sm" variant="secondary" icon={playing ? Pause : Play} onClick={both}>{playing ? 'Pause both' : 'Play both from start'}</Button>;
}

export const StillFrame = ({src, label, onOpen, caption}) => (
  <div className="player still">
    {caption && <div className="player-caption">{caption}</div>}
    <button type="button" className="player-frame still-frame" onClick={onOpen} aria-label={`${label} — enlarge`}>
      <img src={src} alt={label} draggable="false" />
    </button>
  </div>
);
