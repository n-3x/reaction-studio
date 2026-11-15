import {api, saveDownload, upload} from './api.js';
import {actualStep, canConfigureMotion, STEP_LABELS} from './lib.js';
import {selectedJob, useStudio} from './store.js';

const S = () => useStudio.getState();
export const toastError = error => S().toast(error?.message || String(error), 'error');

export function pickFile(accept, multiple = false) {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept; input.multiple = multiple;
    input.onchange = () => resolve([...input.files]);
    input.oncancel = () => resolve([]);
    input.click();
  });
}

export async function projectAction(action, data = {}) {
  const s = S(), job = selectedJob(s);
  if (!job || s.sending || s.uploadCount) return;
  s.setSending(true);
  try {
    const result = await api(`/api/jobs/${job.id}/${action}`, data);
    await S().refresh();
    if (result.id) {
      if (!S().data.jobs.some(j => j.id === result.id)) await S().refresh();
      S().selectJob(result.id);
    }
    return result;
  } catch (error) { toastError(error); }
  finally { S().setSending(false); }
}

export const revisionData = () => {
  const d = S().draft;
  return {start: d.start, duration: d.duration, short_mode: d.shortMode, image_mode: d.imageMode, image_prompt: d.imagePrompt, motion_prompt: d.motionPrompt, request_key: crypto.randomUUID()};
};

let promptChain = null;
export function saveProjectPrompt(kind) {
  const s = S(), job = selectedJob(s);
  const value = kind === 'image' ? s.draft.imagePrompt : s.draft.motionPrompt;
  if (!job || job.motion_prompt_locked || job.busy || value === job[kind + '_prompt']) return promptChain;
  promptChain = (promptChain || Promise.resolve())
    .then(() => api(`/api/jobs/${job.id}/prompt`, {[kind + '_prompt']: value}))
    .then(() => useStudio.setState(st => ({data: {...st.data, jobs: st.data.jobs.map(j => j.id === job.id ? {...j, [kind + '_prompt']: value} : j)}})))
    .catch(toastError);
  return promptChain;
}
export const flushPrompts = async () => { if (promptChain) await promptChain; };

export async function saveTemplate(kind, action, {id, name, text}) {
  const entry = await api('/api/prompts', {kind, ...(action !== 'save' ? {id} : {}), name, text, delete: action === 'delete'});
  await S().refresh();
  return entry;
}

export async function uploadReference(file, onProgress) {
  if (!file) return;
  if (!file.type.startsWith('video/') && !/\.(mp4|mov|m4v|webm)$/i.test(file.name)) { toastError(new Error('Choose a video file for the reference.')); return; }
  try {
    const entry = await upload(file, onProgress);
    if (entry.kind !== 'video') throw new Error('Choose a video file for the reference.');
    S().setDraft({referenceAsset: entry.id, mode: 'file', start: 0, duration: 3});
  } catch (error) { toastError(error); }
}

export async function attachImage(file, jobId = S().selectedId) {
  const job = S().data.jobs.find(j => j.id === jobId);
  if (!file || !job || job.busy || S().sending) return;
  if (!/^image\//.test(file.type)) { toastError(new Error('Choose an image (PNG, JPG or WebP).')); return; }
  S().setSending(true);
  try {
    const image = await upload(file);
    await api(`/api/jobs/${jobId}/attach`, {asset: image.id});
    await S().refresh();
    S().toast('Starting image added. Review it before continuing.', 'success');
  } catch (error) { toastError(error); }
  finally { S().setSending(false); }
}
export async function pickStartingImage() { const [file] = await pickFile('image/png,image/jpeg,image/webp'); if (file) await attachImage(file); }

export async function createProject() {
  const s = S(), d = s.draft;
  if (s.sending || s.uploadCount) return;
  const reference = d.mode === 'url' ? d.referenceUrl.trim() : d.referenceAsset;
  if (!reference) { toastError(new Error('Add a reference video or paste an Instagram link first.')); return; }
  if (!d.profile) { toastError(new Error('Add a model before preparing the reference.')); s.openDialog('model'); return; }
  s.setSending(true);
  try {
    await flushPrompts();
    const result = await api('/api/jobs', {start: d.start, duration: d.duration, short_mode: d.shortMode, image_mode: d.imageMode, image_prompt: d.imagePrompt, motion_prompt: d.motionPrompt, request_key: d.requestKey, title: d.title, profile: d.profile, reference});
    await S().refresh();
    S().selectJob(result.id);
  } catch (error) { toastError(error); }
  finally { S().setSending(false); }
}

export async function exportProject() {
  const s = S(), job = selectedJob(s), x = s.exportSettings;
  if (job.generated_seconds < 3 && !x.retime) throw new Error('Choose to retime the clip to three seconds, or create a revision for a new result.');
  await api(`/api/jobs/${job.id}/export`, {retime: x.retime, audio_gain: x.gain, include_hook_audio: x.includeHookAudio});
  S().setExportDirty(false);
}

export function retimeBlocked(job, x, viewStep) {
  return viewStep === 'export' && job?.media.generated && job.generated_seconds < 3 && !x.retime;
}

// What the single primary button in the inspector means right now.
export function computePrimary(s) {
  const job = selectedJob(s), x = s.exportSettings, view = s.viewStep;
  const busy = Boolean(job?.busy), shortInput = job?.step === 'reference_review' && job.reference_seconds < 2.98;
  const active = view === 'export' && job?.media.generated ? 'export' : view === 'motion' && canConfigureMotion(job) ? 'motion' : actualStep(job);
  const falReady = s.data?.settings.video_ready, vp = s.data?.settings.video_provider === 'aimlapi' ? 'AIMLAPI' : 'fal';
  let label = 'Prepare reference', note = '', progress = 'Choose a model and a reference.', tone = 'primary';
  if (job) {
    progress = busy ? (STEP_LABELS[job.step] || 'Working') + '…' : {reference: 'Play the selection and check the reaction.', image: 'Check the image before the paid motion step.', motion: job.media.generated ? 'Review the motion before continuing.' : 'Resume to check the saved request.', export: 'The hook and full soundtrack stay separate.'}[active];
    if (busy) label = (STEP_LABELS[job.step] || 'Working') + '…';
    else if (view !== active && !(view === 'export' && job.media.generated) && !(view === 'motion' && canConfigureMotion(job))) label = 'Go to ' + {reference: 'reference', image: 'starting image', motion: 'motion', export: 'assets'}[active];
    else if (job.step === 'complete' && job.media.bundle && !s.exportDirty) label = 'Download project';
    else if (active === 'export' && !job.media.generated) label = 'Download video';
    else if (active === 'export') label = s.exportDirty ? 'Export with changes' : 'Export project';
    else if (active === 'motion' && job.media.generated) label = 'Continue to edit';
    else if (job.step === 'reference_review') label = job.media.image ? 'Approve reference' : 'Approve & create image';
    else if (job.step === 'needs_image') label = job.image_mode === 'manual' ? 'Upload starting image' : 'Retry image creation';
    else if (canConfigureMotion(job)) {
      label = view === 'image' ? 'Continue to motion' : falReady ? 'Generate motion' : 'Connect ' + vp;
      if (view === 'motion') { note = 'Submits one paid Kling attempt (about $' + (s.data?.estimated_video_cost ?? 0.378).toFixed(2) + ').'; progress = 'Edit the prompt, then generate when ready.'; }
    } else label = 'Resume saved step';
    if (active === 'export' && job.media.generated && !job.media.bundle) note = 'ZIP · hook.mp4 + complete soundtrack.m4a';
    if (retimeBlocked(job, x, view)) note = 'Choose retiming above, or create a revision.';
    if (shortInput && view === 'reference') { label = 'Adjust trim to continue'; progress = 'This selection is shorter than three seconds.'; note = 'Extend the selection, or slow it to 3 seconds.'; }
    if (view === 'motion' && canConfigureMotion(job) && !falReady) note = 'Connect your ' + vp + ' key before generating motion.';
  } else {
    const d = s.draft;
    if (!d.profile) progress = 'Add a model first.'; else if (d.mode === 'file' && !d.referenceAsset) progress = 'Add a reference video to start.'; else if (d.mode === 'url' && !d.referenceUrl.trim()) progress = 'Paste an Instagram link to start.'; else progress = 'Ready to prepare your selection.';
  }
  if (s.uploadCount) { label = 'Uploading…'; progress = 'Your file is uploading.'; }
  if (!s.connected) { label = 'Server disconnected'; progress = 'Restart the local server to continue.'; tone = 'secondary'; }
  const disabled = !s.connected || Boolean(s.sending || s.uploadCount || busy || (shortInput && view === 'reference') || retimeBlocked(job, x, view) && (!job.media.bundle || s.exportDirty));
  return {label, note, progress, disabled, tone, busy: busy || s.sending || s.uploadCount > 0};
}

export async function runPrimary() {
  const s = S(), job = selectedJob(s), view = s.viewStep, x = s.exportSettings;
  if (s.sending || s.uploadCount || job?.busy || !s.connected) return;
  const active = actualStep(job);
  if (job && view !== active && !(view === 'export' && job.media.generated) && !(view === 'motion' && canConfigureMotion(job))) { s.setStep(active); return; }
  if (view === 'image' && canConfigureMotion(job)) { s.setStep('motion'); return; }
  if (job?.media.bundle && job.step === 'complete' && !s.exportDirty) { saveDownload(job.media.bundle); return; }
  if (job && active === 'export' && !job.media.generated) { saveDownload(job.media.final || job.media.hook); return; }
  if (job?.media.generated && view === 'motion') { s.setStep('edit'); return; }
  if (!job) { await createProject(); return; }
  if (view !== 'export' && ['image_ready', 'image_review', 'needs_key'].includes(job.step) && !s.data.settings.video_ready) { s.openDialog('connections'); return; }
  if (job.step === 'needs_image' && job.image_mode === 'manual') { await pickStartingImage(); return; }
  s.setSending(true);
  try {
    await flushPrompts();
    if (view === 'export' && job.media.generated) await exportProject();
    else {
      const d = S().draft;
      await api(`/api/jobs/${job.id}/run`, {
        approve_reference: job.step === 'reference_review',
        ...(!job.motion_prompt_locked ? {image_prompt: d.imagePrompt} : {}),
        approve_image: ['image_ready', 'image_review', 'needs_key'].includes(job.step),
        ...(canConfigureMotion(job) ? {motion_prompt: d.motionPrompt} : {}),
      });
    }
    await S().refresh();
  } catch (error) { toastError(error); }
  finally { S().setSending(false); }
}

export async function renameProject(title) {
  const job = selectedJob(S()); title = title.trim();
  if (!job || !title || title === job.title) return;
  try { await api(`/api/jobs/${job.id}/rename`, {title}); await S().refresh(); } catch (error) { toastError(error); }
}

export async function chatgpt(action, extra = {}) {
  try {
    const result = await api('/api/chatgpt', {action, ...extra});
    await S().refresh();
    return result;
  } catch (error) { toastError(error); }
}
