import {create} from 'zustand';
import {actualStep, previewFor} from './lib.js';

const read = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const write = (key, value) => { try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch {} };

let lastSelection, lastStep, toastId = 0, pollPromise = null;

export const newDraft = data => ({
  profile: data?.defaults?.profile && data.profiles?.some(p => p.name === data.defaults.profile) ? data.defaults.profile : data?.profiles?.[0]?.name || '',
  mode: 'file', referenceAsset: null, referenceUrl: '', start: 0, duration: 3, shortMode: 'original',
  imageMode: data?.settings?.chatgpt?.active ? 'codex' : 'manual',
  imagePrompt: data?.default_image_prompt || '', motionPrompt: data?.default_motion_prompt || '', title: '',
  requestKey: crypto.randomUUID(),
});

export const useStudio = create((set, get) => ({
  data: null, loaded: false, connected: true,
  selectedId: read('rs-selected', null), viewStep: 'reference', previewKind: 'image', compare: false,
  sidebarOpen: false, theme: read('rs-theme', 'system'), toasts: [], uploadCount: 0, sending: false, exportDirty: false,
  dialog: null, draft: newDraft(null), focusMode: false, exportSettings: {retime: false, gain: 1, includeHookAudio: false},

  uploading: delta => set(s => ({uploadCount: Math.max(0, s.uploadCount + delta)})),
  addAsset: asset => set(s => s.data && !s.data.assets.some(a => a.id === asset.id) ? {data: {...s.data, assets: [...s.data.assets, asset]}} : {}),
  setSending: sending => set({sending}),
  openDialog: dialog => set({dialog}),
  closeDialog: () => set({dialog: null}),
  setSidebar: sidebarOpen => set({sidebarOpen}),
  setFocusMode: focusMode => set({focusMode}),
  setExportDirty: exportDirty => set({exportDirty}),
  setCompare: compare => set({compare}),
  setPreviewKind: previewKind => set({previewKind}),
  setDraft: patch => set(s => ({draft: {...s.draft, ...patch}})),
  setExportSettings: patch => set(s => ({exportSettings: {...s.exportSettings, ...patch}})),
  setTheme: theme => { write('rs-theme', theme); set({theme}); applyTheme(theme); },

  toast: (text, kind = 'info') => {
    const id = ++toastId;
    set(s => ({toasts: [...s.toasts.slice(-3), {id, text, kind}]}));
    if (kind !== 'error') setTimeout(() => get().dismissToast(id), 5000);
    return id;
  },
  dismissToast: id => set(s => ({toasts: s.toasts.filter(t => t.id !== id)})),

  setStep: step => { const job = selectedJob(get()); set({viewStep: step, previewKind: previewFor(step, job), compare: step === 'image'}); },
  selectJob: id => {
    write('rs-selected', id); lastSelection = undefined; lastStep = undefined;
    set({selectedId: id, sidebarOpen: false, exportDirty: false}); syncFlow();
  },
  newProject: () => {
    write('rs-selected', null); lastSelection = undefined; lastStep = undefined;
    set(s => ({selectedId: null, viewStep: 'reference', previewKind: 'image', compare: false, sidebarOpen: false, exportDirty: false, draft: newDraft(s.data)}));
  },

  refresh: async (initial = false) => {
    if (pollPromise) return pollPromise;
    pollPromise = (async () => {
      try {
        const response = await fetch('/api/state', {cache: 'no-store'});
        if (!response.ok) throw new Error('state');
        const data = await response.json();
        set(s => {
          const next = {data, connected: true, loaded: true};
          if (initial && !data.jobs.some(j => j.id === s.selectedId)) next.selectedId = null;
          if (!s.loaded) next.draft = newDraft(data);
          else if (!s.draft.profile && data.profiles.length) next.draft = {...s.draft, profile: data.profiles[0].name};
          return next;
        });
        syncFlow();
      } catch { set({connected: false, loaded: true}); }
    })();
    try { await pollPromise; } finally { pollPromise = null; }
  },
}));

export const selectedJob = s => s.data?.jobs.find(j => j.id === s.selectedId);
export const useJob = () => useStudio(selectedJob);

// Moves the view to where the project actually is when it is opened or finishes a long step.
function syncFlow() {
  const s = useStudio.getState(), job = selectedJob(s);
  if (lastSelection !== s.selectedId) {
    const step = actualStep(job);
    useStudio.setState({viewStep: step, previewKind: previewFor(step, job), compare: step === 'image'});
    if (job) hydrate(job);
    if (job || !s.selectedId) lastSelection = s.selectedId;
    lastStep = job?.step;
  } else if (job?.step !== lastStep) {
    const wasBusy = ['preparing', 'creating_image', 'submitting', 'queued', 'generating', 'exporting'].includes(lastStep);
    if (wasBusy || ['reference_review', 'image_review', 'hook_review', 'complete'].includes(job?.step)) {
      const step = actualStep(job);
      useStudio.setState({viewStep: step, previewKind: previewFor(step, job), compare: step === 'image'});
    }
    lastStep = job?.step;
  }
}

// Project fields shown in the editor are seeded from the saved project once, when it is opened.
function hydrate(job) {
  const s = useStudio.getState(), report = job.export_report || {};
  useStudio.setState({
    draft: {...s.draft, profile: job.profile, title: job.title, start: job.source_start ?? job.start ?? 0, duration: job.source_duration ?? job.duration ?? 3,
      shortMode: ['original', 'slow'].includes(job.short_mode) ? job.short_mode : 'original', imageMode: job.image_mode || 'codex',
      imagePrompt: job.image_prompt ?? s.data.default_image_prompt ?? '',
      motionPrompt: job.motion_prompt ?? (job.motion_prompt_locked ? '' : s.data.default_motion_prompt || '')},
    exportSettings: {retime: Boolean(report.retimed), gain: report.soundtrack_gain ?? report.audio_gain ?? 1, includeHookAudio: Boolean(report.include_hook_audio)},
  });
}

const darkQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
export function applyTheme(theme = useStudio.getState().theme) {
  const root = document.documentElement, dark = theme === 'dark' || (theme === 'system' && (darkQuery ? darkQuery.matches : true));
  root.classList.toggle('dark', dark);
  if (theme === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', theme);
}
darkQuery?.addEventListener?.('change', () => applyTheme());
