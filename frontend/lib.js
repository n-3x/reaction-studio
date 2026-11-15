export const FPS = 30;
export const STEPS = [
  {id: 'reference', label: 'Reference', hint: 'Pick the reaction'},
  {id: 'image', label: 'Starting image', hint: 'Recreate your model'},
  {id: 'motion', label: 'Motion', hint: 'Generate the hook'},
  {id: 'edit', label: 'Edit', hint: 'Build the final reel'},
  {id: 'export', label: 'Assets', hint: 'Download'},
];
export const STEP_LABELS = {
  created: 'Starting', preparing: 'Preparing reference', reference_review: 'Review reference', creating_image: 'Creating image',
  needs_image: 'Image needed', image_ready: 'Review image', image_review: 'Review image', needs_key: 'Connect fal',
  submitting: 'Submitting', queued: 'In queue', generating: 'Generating motion', hook_review: 'Review motion',
  exporting: 'Exporting', complete: 'Ready', pending: 'Still running', interrupted: 'Paused', error: 'Needs attention', assembling: 'Assembling',
};
export const ATTENTION = ['reference_review', 'image_review', 'image_ready', 'hook_review', 'needs_image', 'needs_key', 'error', 'interrupted'];

export const frame = v => Math.round(Number(v) * FPS) / FPS;
export const floorFrame = v => Math.floor(Number(v) * FPS + 0.001) / FPS;
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const secs = v => Number(v || 0).toFixed(1) + 's';
export function clock(value, frames = false) {
  const n = Math.max(0, Number(value || 0));
  const m = Math.floor(n / 60), s = Math.floor(n % 60);
  const base = m + ':' + String(s).padStart(2, '0');
  return frames ? base + '.' + String(Math.round((n % 1) * 100) % 100).padStart(2, '0') : base;
}
export const downloadUrl = url => url + (url.includes('?') ? '&' : '?') + 'download=1';
export const uid = () => crypto.randomUUID();
export const stripUrl = (src, n, h = 72) => `/api/filmstrip?src=${encodeURIComponent(src.split('?')[0])}&n=${n}&h=${h}`;
export const quantizeFrames = need => [6, 12, 24, 48].find(n => n >= need) || 48;

// --- Workflow step logic: where a project actually is, independent of which step the user is viewing.
export function currentStep(job) {
  if (!job || !job.media.reference || !job.reference_approved) return 'reference';
  if (job.media.generated) return job.step === 'complete' || job.step === 'exporting' ? 'export' : 'motion';
  if (job.media.final || job.media.hook) return 'export';
  if (['submitting', 'queued', 'generating', 'pending'].includes(job.step) || job.request_id) return 'motion';
  return 'image';
}
export function actualStep(job) {
  if (job?.media.generated) return ['complete', 'exporting'].includes(job.step) ? 'export' : 'motion';
  if (job?.media.final || job?.media.hook) return 'export';
  return currentStep(job);
}
export function canConfigureMotion(job) {
  return Boolean(job?.media.image && job.reference_approved && !job.motion_prompt_locked && !job.request_id && ['image_ready', 'image_review', 'needs_key'].includes(job.step));
}
export function stepAvailable(step, job) {
  switch (step) {
    case 'reference': return true;
    case 'image': return Boolean(job?.media.frame);
    case 'motion': return Boolean(canConfigureMotion(job) || job?.image_approved || job?.request_id || job?.media.generated);
    case 'edit': return Boolean(job?.media.reference);
    case 'export': return Boolean(job?.media.generated || job?.media.hook || job?.media.final);
    default: return false;
  }
}
export const isBusyStep = step => ['preparing', 'creating_image', 'submitting', 'queued', 'generating', 'exporting', 'assembling'].includes(step);
export function previewFor(step, job) {
  return step === 'image' ? 'image' : step === 'export' ? (job?.media.hook ? 'hook' : 'generated') : 'generated';
}
