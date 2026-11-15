import {useCallback, useEffect, useMemo, useRef} from 'react';
import {FPS, clamp} from './lib.js';
import {setPlayhead, usePlayhead} from './playhead.js';

// Plays a list of trimmed clips back to back, with the reel soundtrack on a separate element.
// items: [{id,url,start,end,offset,dur,volume}] — audio: {url, start, seconds, gain, active}
export function useSequencePlayer({items, audio, videoRef, musicRef, rate = 1}) {
  const itemsRef = useRef(items), audioRef = useRef(audio), activeId = useRef(null), loading = useRef(false), pending = useRef(null);
  const playing = useRef(false), cursor = useRef(0);
  itemsRef.current = items; audioRef.current = audio;
  const total = useMemo(() => items.reduce((n, i) => n + i.dur, 0), [items]);
  const totalRef = useRef(total); totalRef.current = total;

  const publish = useCallback(() => setPlayhead({cursor: cursor.current, playing: playing.current}), []);
  const at = t => { const list = itemsRef.current; return list.find(i => t < i.offset + i.dur - 1e-5) || list[list.length - 1]; };

  const syncMusic = useCallback(() => {
    const m = musicRef.current, a = audioRef.current; if (!m) return;
    if (!a?.active || !a.url) { m.pause(); return; }
    if (m.getAttribute('src') !== a.url) { m.src = a.url; m.load(); }
    m.volume = clamp(a.gain, 0, 1); m.playbackRate = rate;
    const target = a.start + cursor.current;
    if (target >= a.seconds) { m.pause(); return; }
    if (Math.abs(m.currentTime - target) > 0.25) m.currentTime = target;
    if (playing.current && m.paused) m.play().catch(() => {}); else if (!playing.current) m.pause();
  }, [musicRef, rate]);

  const load = useCallback((item, local, autoplay) => {
    const v = videoRef.current; if (!v || !item) return;
    activeId.current = item.id; v.volume = clamp(item.volume ?? 1, 0, 1); v.muted = item.volume === 0;
    if (v.getAttribute('src') !== item.url) {
      loading.current = true; pending.current = {local, autoplay}; v.src = item.url; v.load();
    } else {
      v.currentTime = local;
      if (autoplay) v.play().catch(() => { playing.current = false; publish(); });
    }
  }, [videoRef, publish]);

  const seek = useCallback((t, {keepPlaying = playing.current} = {}) => {
    const list = itemsRef.current; if (!list.length) return;
    t = clamp(t, 0, totalRef.current); cursor.current = t;
    const item = at(t), local = Math.min(item.end - 0.001, item.start + Math.max(0, t - item.offset));
    const was = playing.current; playing.current = keepPlaying && was;
    load(item, local, playing.current); syncMusic(); publish();
  }, [load, syncMusic, publish]);

  const play = useCallback(() => {
    if (!itemsRef.current.length) return;
    if (cursor.current >= totalRef.current - 0.02) cursor.current = 0;
    playing.current = true;
    const item = at(cursor.current); load(item, Math.min(item.end - 0.001, item.start + cursor.current - item.offset), true);
    syncMusic(); publish();
  }, [load, syncMusic, publish]);

  const pause = useCallback(() => {
    playing.current = false; videoRef.current?.pause(); musicRef.current?.pause(); publish();
  }, [videoRef, musicRef, publish]);

  const toggle = useCallback(() => playing.current ? pause() : play(), [play, pause]);
  const step = useCallback(n => { pause(); seek(cursor.current + n / FPS, {keepPlaying: false}); }, [pause, seek]);

  // Advance the cursor from the real video clock and hop to the next clip at each out point.
  // Driven by rAF for smoothness, and by media events so it keeps working in background tabs.
  const tick = useCallback(() => {
    const v = videoRef.current; if (!playing.current || !v || loading.current) return;
    const item = itemsRef.current.find(i => i.id === activeId.current); if (!item) return;
    const t = v.currentTime;
    if (t >= item.end - 0.02 || v.ended) {
      const next = itemsRef.current[itemsRef.current.indexOf(item) + 1];
      if (next) { cursor.current = next.offset; load(next, next.start, true); }
      else { playing.current = false; v.pause(); musicRef.current?.pause(); cursor.current = totalRef.current; }
    } else cursor.current = clamp(item.offset + Math.max(0, t - item.start), 0, totalRef.current);
    syncMusic(); publish();
  }, [videoRef, musicRef, load, syncMusic, publish]);
  useEffect(() => {
    let id; const loop = () => { id = requestAnimationFrame(loop); tick(); };
    id = requestAnimationFrame(loop); return () => cancelAnimationFrame(id);
  }, [tick]);

  // Attached as the <video>'s onLoadedMetadata so it works however often the element is (re)mounted.
  const onLoadedMetadata = useCallback(e => {
    const v = e.currentTarget;
    loading.current = false;
    if (pending.current) { const p = pending.current; pending.current = null; v.currentTime = p.local; if (p.autoplay && playing.current) v.play().catch(() => {}); }
  }, []);

  useEffect(() => { if (videoRef.current) videoRef.current.playbackRate = rate; if (musicRef.current) musicRef.current.playbackRate = rate; }, [rate, videoRef, musicRef]);

  // When the edit changes, stay at the same time and refresh what's shown.
  const signature = items.map(i => `${i.id}:${i.url}:${i.start}:${i.end}:${i.volume}`).join('|') + '|' + (audio?.active ? audio.url + audio.start + audio.gain : 'x');
  useEffect(() => {
    if (!items.length) { videoRef.current?.pause(); videoRef.current?.removeAttribute('src'); playing.current = false; cursor.current = 0; publish(); return; }
    const t = clamp(cursor.current, 0, total);
    if (playing.current) { const item = at(t); activeId.current = item.id; if (videoRef.current) videoRef.current.volume = clamp(item.volume ?? 1, 0, 1); syncMusic(); }
    else seek(t, {keepPlaying: false});
  }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { playing.current = false; videoRef.current?.pause(); musicRef.current?.pause(); setPlayhead({playing: false}); }, [videoRef, musicRef]);

  return {play, pause, toggle, seek, step, total, cursorRef: cursor, playingRef: playing, videoProps: {onLoadedMetadata, onEnded: tick, onTimeUpdate: tick}};
}
export const usePlaying = () => usePlayhead(s => s.playing);
