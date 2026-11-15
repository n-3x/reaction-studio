import {create} from 'zustand';
import {api} from './api.js';
import {floorFrame, uid} from './lib.js';
import {useStudio} from './store.js';

const entries = new Map();
const tick = create(() => ({v: 0}));
const bump = () => tick.setState(s => ({v: s.v + 1}));
const clone = v => JSON.parse(JSON.stringify(v));
const blank = job => ({clips: [], audio_mode: job.source_has_audio ? 'reel' : 'clips', audio_gain: 1, audio_start: 0, keep_full_audio: true});

export function resolveSource(source, data) {
  if (!source || !data) return null;
  if (source.kind === 'asset') { const a = data.assets.find(x => x.id === source.id); return a ? {url: a.url, duration: a.duration, name: a.name} : null; }
  const job = data.jobs.find(j => j.id === source.id);
  return job?.media[source.media] ? {url: job.media[source.media], duration: source.media === 'hook' ? 3 : job.generated_seconds, name: job.title} : null;
}

export function useEntry(job) {
  tick(s => s.v);
  if (!job?.media.reference) return null;
  let entry = entries.get(job.id);
  if (!entry) {
    entry = {id: job.id, doc: clone(job.edit || blank(job)), version: job.edit_version || 0, dirty: false, revision: 0, selected: null, error: '', saving: null, timer: null, undo: [], redo: [], seeded: Boolean(job.edit)};
    entries.set(job.id, entry);
  } else if (!entry.dirty && !entry.saving && (job.edit_version || 0) > entry.version) {
    entry.doc = clone(job.edit); entry.version = job.edit_version; entry.error = '';
  }
  if (!entry.doc.clips.some(c => c.id === entry.selected)) entry.selected = entry.doc.clips[0]?.id || null;
  return entry;
}

export function seedEntry(job) {
  const entry = entries.get(job.id);
  if (!entry || entry.seeded || !(job.media.hook || job.media.generated)) return;
  const media = job.media.hook ? 'hook' : 'generated';
  entry.doc.clips.push({id: uid(), source: {kind: 'job', id: job.id, media}, start: 0, end: floorFrame(media === 'hook' ? 3 : job.generated_seconds), volume: 1});
  entry.seeded = true; entry.dirty = true; entry.revision++; schedule(entry); bump();
}

function schedule(entry) { clearTimeout(entry.timer); entry.timer = setTimeout(() => save(entry).catch(() => {}), 650); }

export async function save(entry) {
  clearTimeout(entry.timer);
  if (entry.saving) { await entry.saving; if (entry.dirty) return save(entry); return; }
  if (!entry.dirty) return;
  const revision = entry.revision, document = clone(entry.doc);
  entry.saving = (async () => {
    try {
      const result = await api(`/api/jobs/${entry.id}/edit`, {edit: document, version: entry.version});
      entry.version = result.version;
      if (entry.revision === revision) { entry.doc = result.edit; entry.dirty = false; }
      entry.error = '';
    } catch (error) { entry.error = error.message; throw error; }
    finally { entry.saving = null; bump(); }
  })();
  bump();
  return entry.saving;
}

export function mutate(jobId, fn, {history = true} = {}) {
  const entry = entries.get(jobId); if (!entry) return;
  if (history) { entry.undo.push(clone(entry.doc)); if (entry.undo.length > 50) entry.undo.shift(); entry.redo = []; }
  fn(entry.doc, entry);
  entry.seeded = true; entry.revision++; entry.dirty = true; entry.error = ''; schedule(entry); bump();
}
export function history(jobId, direction) {
  const entry = entries.get(jobId); if (!entry) return;
  const [from, to] = direction === 'undo' ? [entry.undo, entry.redo] : [entry.redo, entry.undo];
  if (!from.length) return;
  to.push(clone(entry.doc)); entry.doc = from.pop();
  entry.revision++; entry.dirty = true; schedule(entry); bump();
}
export function select(jobId, id) { const entry = entries.get(jobId); if (entry && entry.selected !== id) { entry.selected = id; bump(); } }

export async function renderFinal(jobId) {
  const entry = entries.get(jobId); if (!entry) return;
  const store = useStudio.getState(); store.setSending(true);
  try {
    await save(entry);
    if (entry.error) throw new Error(entry.error);
    const result = await api(`/api/jobs/${jobId}/assemble`, {edit: entry.doc, version: entry.version});
    entry.version = result.version; entry.doc = result.edit; entry.dirty = false;
    await store.refresh();
    store.toast('Rendering your final video…');
  } catch (error) { entry.error = error.message; store.toast(error.message, 'error'); }
  finally { store.setSending(false); bump(); }
}
