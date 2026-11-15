import {Copy, Download, ExternalLink, ImageUp, PackageOpen, RefreshCw, Upload} from 'lucide-react';
import {useEffect, useState} from 'react';
import {attachImage, pickStartingImage, projectAction} from '../actions.js';
import {Button, Callout, Disclosure, Modal, Spinner} from '../components/ui.jsx';
import {StillFrame} from '../components/Player.jsx';
import {PromptEditor} from '../components/PromptEditor.jsx';
import {downloadUrl} from '../lib.js';
import {useJob, useStudio} from '../store.js';
import {StageHeader, Workspace} from './common.jsx';

export function ManualGuide({job, compact}) {
  const draft = useStudio(s => s.draft), toast = useStudio(s => s.toast), busy = job.busy || useStudio(s => s.sending);
  const [over, setOver] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(draft.imagePrompt); toast('Prompt copied.', 'success'); } catch { toast('Clipboard blocked — the prompt is inside the reference pack.', 'error'); } };
  useEffect(() => {
    const paste = e => { const f = [...(e.clipboardData?.files || [])].find(x => x.type.startsWith('image/')); if (f && !busy) { e.preventDefault(); attachImage(f); } };
    window.addEventListener('paste', paste); return () => window.removeEventListener('paste', paste);
  }, [busy]);
  return (
    <div className={'manual' + (compact ? ' compact' : '')}>
      <ol>
        <li><span className="n">1</span><div><b>Get the reference pack</b><p>Your model's photos, the reference frame and the prompt in one ZIP.</p>
          <Button size="sm" icon={PackageOpen} onClick={() => { const a = document.createElement('a'); a.href = `/api/jobs/${job.id}/chatgpt-pack`; a.download = ''; a.click(); }}>Download pack</Button></div></li>
        <li><span className="n">2</span><div><b>Make the image in ChatGPT</b><p>Attach the photos, then the reference frame last. Paste the prompt. Free accounts can do this.</p>
          <div className="row-actions"><Button size="sm" icon={Copy} onClick={copy}>Copy prompt</Button><Button size="sm" icon={ExternalLink} onClick={() => window.open('https://chatgpt.com/', '_blank', 'noopener')}>Open ChatGPT</Button></div></div></li>
        <li><span className="n">3</span><div><b>Bring the result back</b><p>Drop the image here, paste it with ⌘V, or choose a file.</p>
          <button type="button" className={'dropzone small' + (over ? ' over' : '')} disabled={busy} onClick={pickStartingImage} onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={e => { e.preventDefault(); setOver(false); attachImage(e.dataTransfer.files[0]); }}>
            <ImageUp size={18} /><span>Drop, paste or choose the starting image</span></button></div></li>
      </ol>
    </div>
  );
}

export default function ImageStage() {
  const job = useJob(), data = useStudio(s => s.data), sending = useStudio(s => s.sending), draft = useStudio(s => s.draft);
  const [zoom, setZoom] = useState(null);
  if (!job) return null;
  const {frame, image} = job.media;
  const chat = data.settings.chatgpt, account = chat.app_signed_in || chat.system_signed_in;
  const creating = job.step === 'creating_image', needs = job.step === 'needs_image';
  const locked = Boolean(job.request_id) || !job.reference_approved || job.motion_prompt_locked;
  const busy = job.busy || sending;
  const open = (src, label) => setZoom({src, label});

  const stage = (
    <>
      <StageHeader title="Starting image" meta={image ? 'Check identity, pose and hands against the reference' : creating ? 'Creating your starting image' : 'Needs a starting image'} />
      <div className="canvas compare">
        {frame && <StillFrame src={frame} label="Reference frame" caption={<><b>Reference frame</b><span>motion start</span></>} onOpen={() => open(frame, 'Reference frame')} />}
        {image ? <StillFrame src={image} label="Starting image" caption={<><b>Starting image</b><span>9:16</span></>} onOpen={() => open(image, 'Starting image')} />
          : creating ? <div className="player still"><div className="player-caption"><b>Starting image</b><span>creating</span></div><div className="player-frame making"><Spinner size={26} /><b>Creating with ChatGPT</b><p>Usually 1–3 minutes. You can leave — progress is saved.</p></div></div>
          : needs ? <div className="guide-panel"><h2>Make the starting image</h2><p>{job.error ? 'Automatic creation didn’t work for this account.' : 'Create it in the ChatGPT website — free accounts work.'}</p><ManualGuide job={job} compact /></div> : null}
      </div>
      <Modal open={Boolean(zoom)} onOpenChange={o => !o && setZoom(null)} title={zoom?.label || ''} width={720}>{zoom && <img className="zoom-img" src={zoom.src} alt={zoom.label} />}</Modal>
    </>
  );

  const inspector = (
    <div className="panel">
      <h2>Check the starting image</h2>
      <p className="panel-intro">Match identity, pose, hands and framing before paying for motion.</p>
      {job.error && job.step !== 'error' && <Callout tone="error" title="Image creation needs attention" actions={<><Button size="sm" onClick={() => projectAction('regenerate', {image_prompt: draft.imagePrompt})} disabled={busy}>Try again</Button>{!account && <Button size="sm" onClick={() => useStudio.getState().openDialog('connections')}>Connect ChatGPT</Button>}</>}>{job.error}</Callout>}
      {!account && !image && job.image_mode === 'codex' && !job.error && <Callout tone="warn" title="ChatGPT isn't connected" actions={<Button size="sm" variant="primary" onClick={() => useStudio.getState().openDialog('connections')}>Connect account</Button>}>Connect an account for automatic images, or use the ChatGPT website below.</Callout>}
      <div className="stack">
        <Button icon={RefreshCw} disabled={locked || busy || !job.media.frame} onClick={() => projectAction('regenerate', {image_prompt: draft.imagePrompt})}>{image ? 'Recreate with ChatGPT account' : 'Create with ChatGPT account'}</Button>
        <Button icon={Upload} disabled={locked || busy} onClick={pickStartingImage}>Upload a replacement</Button>
      </div>
      <PromptEditor kind="image" label="Image prompt" rows={8} locked={locked || busy} hint={image ? 'Changes apply when you recreate. Your current image stays until then.' : 'Edit before creating. Saved automatically.'} />
      <Disclosure title="Use the ChatGPT website instead" defaultOpen={false}><ManualGuide job={job} compact /></Disclosure>
      {frame && <a className="link-row" href={downloadUrl(frame)} download><Download size={14} />Download reference frame</a>}
      {locked && job.request_id && <p className="hint">Once motion is submitted, create a revision to change its inputs.</p>}
    </div>
  );
  return <Workspace stage={stage} inspector={inspector} />;
}
