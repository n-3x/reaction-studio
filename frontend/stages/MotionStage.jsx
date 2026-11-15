import {Check, Columns2, Copy as CopyIcon, RefreshCw} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';
import {projectAction, revisionData} from '../actions.js';
import {Button, Callout, Disclosure, IconButton, Spinner} from '../components/ui.jsx';
import {CompareTransport, StillFrame, VideoPlayer} from '../components/Player.jsx';
import {PromptEditor} from '../components/PromptEditor.jsx';
import {canConfigureMotion} from '../lib.js';
import {useJob, useStudio} from '../store.js';
import {StageHeader, Workspace} from './common.jsx';

const PHASES = [['submitting', 'Sent to Kling'], ['queued', 'In the queue'], ['generating', 'Generating motion']];
function useNow(active) { const [now, setNow] = useState(Date.now()); useEffect(() => { if (!active) return; const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, [active]); return now; }

function GenerationStatus({job}) {
  const now = useNow(true), order = PHASES.map(p => p[0]), index = Math.max(0, order.indexOf(job.step === 'pending' ? 'generating' : job.step));
  const since = job.phase_times?.[job.step === 'pending' ? 'generating' : job.step], seconds = since ? Math.max(0, Math.floor((now - new Date(since)) / 1000)) : 0;
  return (
    <div className="gen-status" role="status">
      <h2>Generating your hook</h2>
      <ol>{PHASES.map(([id, label], i) => <li key={id} className={i < index ? 'done' : i === index ? 'now' : ''}>{i < index ? <Check size={14} /> : i === index ? <Spinner size={14} /> : <i />}<span>{label}</span>{i === index && <em>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</em>}</li>)}</ol>
      <p>Usually a few minutes. You can leave — the request is saved and resumes automatically. Nothing is submitted twice.</p>
    </div>
  );
}

export default function MotionStage() {
  const job = useJob(), compare = useStudio(s => s.compare), setCompare = useStudio(s => s.setCompare), sending = useStudio(s => s.sending);
  const left = useRef(null), right = useRef(null);
  if (!job) return null;
  const {generated, image, reference} = job.media;
  const generating = ['submitting', 'queued', 'generating', 'pending'].includes(job.step) || (job.busy && !generated);
  const setup = canConfigureMotion(job);
  const locked = Boolean(job.motion_prompt_locked) || job.busy || sending;

  const stage = (
    <>
      <StageHeader title={generated ? 'Generated motion' : setup ? 'Motion setup' : 'Motion'} meta={generated ? `${Number(job.generated_seconds || 0).toFixed(3)}s · compare against the exact input` : '9:16 · original inputs stay saved'}>
        {generated && reference && <><IconButton label="Compare with input" icon={Columns2} active={compare} onClick={() => setCompare(!compare)} />{compare && <CompareTransport leftRef={left} rightRef={right} />}</>}
      </StageHeader>
      <div className={'canvas' + (generated && compare ? ' compare' : '')}>
        {generated ? <>
          {compare && reference && <VideoPlayer ref={left} src={reference} label="Motion input" muted caption={<><b>Input</b><span>reference</span></>} />}
          <VideoPlayer ref={right} src={generated} label="Generated motion" muted caption={<><b>Generated</b><span>Kling 3.0</span></>} />
        </> : <>
          {reference && <VideoPlayer ref={left} src={reference} label="Motion input" muted loop caption={<><b>Motion input</b><span>3s</span></>} />}
          {generating ? <GenerationStatus job={job} /> : image ? <StillFrame src={image} label="Starting image" caption={<><b>Starting image</b><span>approved</span></>} onOpen={() => {}} /> : <div className="canvas-empty"><h2>No result at this step yet</h2><p>Continue from the current step to create it.</p></div>}
        </>}
      </div>
    </>
  );

  const inspector = (
    <div className="panel">
      <h2>{generated ? 'Review the motion' : 'Describe the motion'}</h2>
      <p className="panel-intro">{generated ? 'Your prompt and result stay saved together.' : 'Guide movement, expression and camera behavior before generating.'}</p>
      {job.error && <Callout tone="error" title="This step needs attention">{job.error}</Callout>}
      <PromptEditor kind="motion" label="Video prompt" rows={8} locked={locked} placeholder="Describe the movement, expression, camera behavior and details to preserve."
        hint={job.motion_prompt_locked ? 'Submitted prompts are locked. Create a revision to change it.' : 'Saved automatically. Leave blank to use the default prompt.'} />
      {generated && <p className="hint">Use Compare to check for jumps, glitches and changes to the face or hands.</p>}
      {(job.request_id || generated) && (
        <Disclosure title="Try a different result"><p className="hint">A new revision lets you adjust the inputs before another paid attempt.</p>
          <Button icon={RefreshCw} disabled={job.busy || sending} onClick={() => projectAction('revise', revisionData())}>Create revision</Button></Disclosure>
      )}
      {job.request_id && <p className="request-id"><span>Saved request</span><code>{job.request_id}</code></p>}
    </div>
  );
  return <Workspace stage={stage} inspector={inspector} />;
}
