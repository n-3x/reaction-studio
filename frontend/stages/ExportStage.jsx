import {Download, Film, Music, PackageCheck, Scissors} from 'lucide-react';
import {Button, Callout, Disclosure, Field, SwitchRow} from '../components/ui.jsx';
import {VideoPlayer} from '../components/Player.jsx';
import {downloadUrl, secs} from '../lib.js';
import {useJob, useStudio} from '../store.js';
import {StageHeader, Workspace} from './common.jsx';

const FILES = [['hook', 'Hook MP4', '3 seconds', Film], ['audio', 'Full reel audio', 'original', Music], ['soundtrack', 'Soundtrack', 'volume applied', Music], ['assembly', 'Edited final video', '1080×1920', Film], ['generated', 'Raw generated motion', 'unedited', Film], ['bundle', 'Project ZIP', 'everything', PackageCheck]];

export default function ExportStage() {
  const job = useJob(), x = useStudio(s => s.exportSettings), setX = useStudio(s => s.setExportSettings), setDirty = useStudio(s => s.setExportDirty), setStep = useStudio(s => s.setStep), busy = useStudio(s => s.sending);
  if (!job) return null;
  const {media} = job, video = media.hook || media.generated || media.final;
  const short = Boolean(job.generated_seconds && job.generated_seconds < 3);
  const touch = patch => { setX(patch); if (job.step === 'complete' && media.generated) setDirty(true); };

  const stage = (
    <>
      <StageHeader title="Assets" meta="3-second hook + full reel soundtrack, kept separate" />
      <div className="canvas">
        {video ? <VideoPlayer src={video} label="Hook preview" muted caption={<><b>{media.hook ? 'Hook export' : 'Generated motion'}</b><span>{media.hook ? '3s' : 'review'}</span></>} /> : <div className="canvas-empty"><h2>Nothing to export yet</h2><p>Generate and review motion first.</p></div>}
      </div>
      {media.audio && <div className="audio-strip"><Music size={15} /><span>Full reel audio · {secs(job.audio_seconds)}</span><audio controls preload="metadata" src={media.audio} aria-label="Complete original reel soundtrack" /></div>}
    </>
  );

  const inspector = (
    <div className="panel">
      <h2>Ready for the next edit</h2>
      <p className="panel-intro">Export the three-second hook and the entire reel soundtrack as separate files.</p>
      {short && media.generated && (
        <Callout tone="warn" title={`This result is ${Number(job.generated_seconds).toFixed(3)}s long`}>
          <SwitchRow id="retime" title="Retime the full motion to 3 seconds" checked={x.retime} disabled={busy || job.busy} onChange={v => touch({retime: v})} />
          <p className="hint">{(job.generated_seconds / 3 * 100).toFixed(2)}% speed, no frozen tail. This fixes duration, not generation artifacts.</p>
        </Callout>
      )}
      <dl className="facts"><div><dt>Hook MP4</dt><dd>3 seconds</dd></div><div><dt>Full reel audio</dt><dd>{job.audio_seconds ? secs(job.audio_seconds) + ' · complete' : 'No source audio'}</dd></div></dl>
      <Disclosure title="Audio & export settings">
        <Field label="Soundtrack volume" aside={Math.round(x.gain * 100) + '%'} htmlFor="gain" hint={job.source_has_audio ? 'Applies to the whole exported soundtrack.' : 'No audio track was found in the source.'}>
          <input id="gain" type="range" min={0} max={200} step={5} value={Math.round(x.gain * 100)} disabled={!job.source_has_audio || busy || job.busy} onChange={e => touch({gain: Number(e.target.value) / 100})} />
        </Field>
        <SwitchRow id="hook-audio" title="Add an audio excerpt to the hook MP4" description="The complete soundtrack is always exported separately." checked={x.includeHookAudio} disabled={!job.source_has_audio || busy || job.busy} onChange={v => touch({includeHookAudio: v})} />
      </Disclosure>
      <h3 className="list-title">Files</h3>
      <ul className="files">
        {FILES.filter(([k]) => media[k]).map(([k, name, sub, Icon]) => (
          <li key={k}><Icon size={15} /><span><b>{name}</b><small>{sub}</small></span><a className="btn btn-ghost btn-sm" href={downloadUrl(media[k])} download aria-label={`Download ${name}`}><Download size={14} /></a></li>
        ))}
        {!Object.keys(media).some(k => FILES.some(f => f[0] === k)) && <li className="empty">Files appear after you export.</li>}
      </ul>
      <Button icon={Scissors} onClick={() => setStep('edit')}>Continue to edit</Button>
    </div>
  );
  return <Workspace stage={stage} inspector={inspector} />;
}
