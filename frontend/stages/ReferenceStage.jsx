import clsx from 'clsx';
import {Clapperboard, Film, KeyRound, Link2, Plus, RotateCcw, Sparkles, Upload, UserRound} from 'lucide-react';
import {useCallback, useRef, useState} from 'react';
import {pickFile, projectAction, revisionData, uploadReference} from '../actions.js';
import {Button, Callout, Disclosure, Field, Segmented, Spinner} from '../components/ui.jsx';
import {VideoPlayer} from '../components/Player.jsx';
import {RangeTimeline} from '../components/Timeline.jsx';
import {PromptEditor} from '../components/PromptEditor.jsx';
import {clamp, clock, frame} from '../lib.js';
import {useJob, useStudio} from '../store.js';
import {StageHeader, Workspace} from './common.jsx';

function SourcePicker() {
  const draft = useStudio(s => s.draft), setDraft = useStudio(s => s.setDraft), data = useStudio(s => s.data), uploadCount = useStudio(s => s.uploadCount);
  const [over, setOver] = useState(false), [progress, setProgress] = useState(null);
  const pick = async () => { const [f] = await pickFile('video/mp4,video/quicktime,video/webm'); if (f) { setProgress(0); await uploadReference(f, setProgress); setProgress(null); } };
  const drop = async e => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) { setProgress(0); await uploadReference(f, setProgress); setProgress(null); } };
  const needs = [!data.profiles.length && 'model', !data.settings.video_ready && 'fal', !(data.settings.chatgpt.app_signed_in || data.settings.chatgpt.system_signed_in) && 'chatgpt'].filter(Boolean);
  const {openDialog} = useStudio.getState();

  return (
    <div className="source-picker">
      <div className="sp-head"><h2>Start with a reaction</h2><p>Pick a reel you want to recreate. You'll choose the exact three seconds next.</p></div>
      <Segmented value={draft.mode} onChange={mode => setDraft({mode})} label="Reference source" options={[{value: 'file', label: 'Upload a video', icon: Upload}, {value: 'url', label: 'Instagram link', icon: Link2}]} />
      {draft.mode === 'file' ? (
        <button type="button" className={clsx('dropzone', over && 'over')} onClick={pick} onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop} disabled={uploadCount > 0}>
          {progress != null ? <><Spinner size={22} /><b>Uploading {progress}%</b><div className="bar"><i style={{width: progress + '%'}} /></div></>
            : <><Upload size={24} /><b>Drop a video here</b><span>or click to browse · MP4, MOV or WebM up to 512 MB</span></>}
        </button>
      ) : (
        <div className="url-box">
          <label className="sr-only" htmlFor="ref-url">Instagram reel link</label>
          <input id="ref-url" type="url" autoFocus placeholder="https://www.instagram.com/reel/…" value={draft.referenceUrl} onChange={e => setDraft({referenceUrl: e.target.value})} />
          <p className="hint">Public reels only. If Instagram asks for a login, download the video and upload it instead.</p>
        </div>
      )}
      <ol className="how">
        <li><Film size={15} /><span><b>Select</b> three seconds of one continuous shot</span></li>
        <li><Sparkles size={15} /><span><b>Recreate</b> your model in that exact pose</span></li>
        <li><Clapperboard size={15} /><span><b>Generate</b> motion, then <b>edit</b> the final reel</span></li>
      </ol>
      {needs.length > 0 && (
        <div className="setup">
          <h3>Before your first video</h3>
          {needs.includes('model') && <button type="button" onClick={() => openDialog('model')}><UserRound size={15} /><span><b>Add your model</b><small>Photos of the influencer you'll recreate</small></span><Plus size={15} /></button>}
          {needs.includes('chatgpt') && <button type="button" onClick={() => openDialog('connections')}><Sparkles size={15} /><span><b>Connect ChatGPT</b><small>Automatic images — or use the website flow</small></span><Plus size={15} /></button>}
          {needs.includes('fal') && <button type="button" onClick={() => openDialog('connections')}><KeyRound size={15} /><span><b>Add your {data.settings.video_provider === 'aimlapi' ? 'AIMLAPI' : 'fal'} key</b><small>Needed to generate motion</small></span><Plus size={15} /></button>}
        </div>
      )}
    </div>
  );
}

export default function ReferenceStage() {
  const job = useJob(), data = useStudio(s => s.data), draft = useStudio(s => s.draft), setDraft = useStudio(s => s.setDraft), sending = useStudio(s => s.sending);
  const asset = !job ? data.assets.find(a => a.id === draft.referenceAsset) : null;
  const [view, setView] = useState('selection');
  const [head, setHead] = useState(0);
  const player = useRef(null), pendingSeek = useRef(null);

  const sourceUrl = job ? job.media.source : asset?.url;
  const total = Number(job?.source_total_duration || asset?.duration || 0);
  const start = Number(draft.start) || 0, length = Number(draft.duration) || 3;
  const showing = job ? (view === 'source' || !job.media.reference ? job.media.source : job.media.reference) : asset?.url;
  const dirty = job && (Math.abs(start - (job.source_start ?? job.start ?? 0)) > 0.001 || Math.abs(length - (job.source_duration ?? job.duration ?? 3)) > 0.001 || draft.shortMode !== (job.short_mode || 'original'));
  const busy = Boolean(job?.busy || sending);
  const sourceView = !job || view === 'source';

  const seekTo = useCallback(t => { if (player.current?.video?.readyState) player.current.seek(t); else pendingSeek.current = t; }, []);
  const onReady = useCallback(() => { if (pendingSeek.current != null) { player.current.seek(pendingSeek.current); pendingSeek.current = null; } }, []);
  const onTime = useCallback(t => {
    setHead(job && !sourceView ? (Number(job.source_start || 0) + t * Number(job.source_duration || 3) / Number(job.reference_seconds || 3)) : t);
  }, [job, sourceView]);
  const change = (next, kind) => {
    setDraft({start: +next.start.toFixed(3), duration: +next.length.toFixed(3)});
    if (job) { setView('source'); }
    seekTo(kind === 'right' ? Math.max(next.start, next.start + next.length - 1 / 30) : next.start);
  };

  const stage = (
    <>
      <StageHeader title={job ? 'Review your reference' : asset ? 'Choose the reaction' : 'New project'} meta={job ? '9:16 · one continuous reaction' : asset ? 'Drag the highlighted window over the three seconds you want' : undefined}>
        {job?.media.source && <Segmented size="sm" value={view} onChange={setView} label="Reference preview" options={[{value: 'selection', label: 'Selection'}, {value: 'source', label: 'Full reel'}]} />}
      </StageHeader>
      <div className="canvas">
        {showing ? <VideoPlayer ref={player} src={showing} label={sourceView ? 'Full source reel' : 'Selected reaction'} onTime={onTime} onReady={onReady}
          caption={<><b>{sourceView ? 'Full reel' : 'Selected reaction'}</b><span>{sourceView ? clock(total, true) : Number(job.reference_seconds || length).toFixed(2) + 's'}</span></>} />
          : job && job.step === 'preparing' ? <div className="canvas-empty"><Spinner size={22} /><h2>Preparing your selection</h2><p>Trimming the reference and extracting its first frame. No generation is submitted.</p></div>
          : <SourcePicker />}
      </div>
      {total > 0 && sourceUrl && (
        <section className="trim" aria-label="Reaction selection">
          <header><h2>Selection</h2><span className="timecode">{clock(start, true)} → {clock(start + length, true)} <i>· {length.toFixed(2)}s of {clock(total)}</i></span></header>
          <RangeTimeline src={sourceUrl} duration={total} start={start} length={length} playhead={head} disabled={busy || Boolean(job && job.step !== 'reference_review' && job.request_id)} onChange={change}
            onSeek={t => { if (job) setView('source'); seekTo(t); setHead(t); }} />
          <div className="trim-actions">
            <Button size="sm" variant="ghost" onClick={() => change({start: clamp(frame(player.current?.currentTime ?? 0), 0, Math.max(0, total - length)), length}, 'move')} disabled={busy || !sourceView}>Start at playhead</Button>
            <Button size="sm" variant="ghost" onClick={() => { const t = player.current?.currentTime ?? 0; if (t > start) change({start, length: clamp(frame(t - start), 0.2, 3)}, 'right'); }} disabled={busy || !sourceView}>End at playhead</Button>
            <span className="grow" />
            {dirty && <><Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => setDraft({start: job.source_start ?? 0, duration: job.source_duration ?? 3, shortMode: job.short_mode || 'original'})}>Reset</Button>
              <Button size="sm" variant="primary" loading={busy} onClick={() => projectAction('revise', revisionData())}>Apply as new revision</Button></>}
          </div>
        </section>
      )}
    </>
  );

  const shortSel = length < 2.98 && draft.shortMode === 'original';
  const inspector = (
    <div className="panel">
      <h2>{job ? 'Reference' : 'Setup'}</h2>
      <p className="panel-intro">{job ? 'Check the reaction is clean and continuous before approving.' : 'Choose a model, then add a reference.'}</p>
      <Field label="Model" htmlFor="profile">
        <div className="model-row">
          {(() => { const p = data.profiles.find(p => p.name === draft.profile); return p ? <img src={p.images[0]} alt="" /> : <span className="ph" />; })()}
          <select id="profile" value={draft.profile} disabled={Boolean(job)} onChange={e => setDraft({profile: e.target.value})}>
            {!data.profiles.length && <option value="">No models yet</option>}
            {data.profiles.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
          </select>
          <Button size="sm" icon={Plus} aria-label="Add a model" onClick={() => useStudio.getState().openDialog('model')}>Add</Button>
        </div>
      </Field>
      {job && <p className="saved-note">Reference saved · {clock(total)} source</p>}
      {shortSel && <Callout tone="warn" title={`Selection is ${length.toFixed(2)}s`} actions={<Button size="sm" onClick={() => setDraft({shortMode: 'slow'})}>Slow to 3 seconds</Button>}>
        At original speed a short selection can't be approved. Extend it, or slow it — slowing can make motion look choppy.</Callout>}
      <Disclosure title="Fine-tune timing" meta={`${start.toFixed(2)}s · ${length.toFixed(2)}s`}>
        <div className="pair">
          <Field label="Start (sec)" htmlFor="t-start"><input id="t-start" type="number" min={0} max={total || undefined} step={0.001} value={draft.start} disabled={busy} onChange={e => setDraft({start: e.target.value})} /></Field>
          <Field label="Length (sec)" htmlFor="t-len"><input id="t-len" type="number" min={0.2} max={3} step={0.001} value={draft.duration} disabled={busy} onChange={e => setDraft({duration: e.target.value})} /></Field>
        </div>
        <Field label="Timing" htmlFor="t-mode" hint="Use one continuous shot. Slowing short clips can make motion choppy.">
          <select id="t-mode" value={draft.shortMode} disabled={busy} onChange={e => setDraft({shortMode: e.target.value})}><option value="original">Original speed</option><option value="slow">Slow selection to 3 seconds</option></select>
        </Field>
      </Disclosure>
      <Disclosure title="Image creation" meta={draft.imageMode === 'codex' ? 'ChatGPT account' : 'ChatGPT website'}>
        <Field label="How should the starting image be made?">
          <Segmented value={draft.imageMode} onChange={imageMode => setDraft({imageMode})} disabled={busy} label="Image creation method" options={[{value: 'codex', label: 'Automatic'}, {value: 'manual', label: 'ChatGPT website'}]} />
        </Field>
        <p className="hint">{draft.imageMode === 'codex' ? 'Uses the ChatGPT account you connected. If your plan doesn’t include it, you’ll be offered the website flow.' : 'You’ll get a reference pack and prompt to use in chatgpt.com — works with free accounts.'}</p>
        <PromptEditor kind="image" label="Image prompt" rows={9} locked={busy || Boolean(job?.motion_prompt_locked)} hint="Saved with the project." />
      </Disclosure>
      {job?.warnings?.length > 0 && <Disclosure title="Reference notes" meta={String(job.warnings.length)} defaultOpen>{job.warnings.map((w, i) => <p className="hint" key={i}>{w}</p>)}</Disclosure>}
    </div>
  );
  return <Workspace stage={stage} inspector={inspector} />;
}
