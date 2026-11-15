import {ImagePlus, X} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';
import {api, upload} from '../api.js';
import {useStudio} from '../store.js';
import {Button, Field, Modal} from './ui.jsx';

export function ModelDialog() {
  const open = useStudio(s => s.dialog === 'model'), close = useStudio(s => s.closeDialog), refresh = useStudio(s => s.refresh), setDraft = useStudio(s => s.setDraft), toast = useStudio(s => s.toast);
  const [name, setName] = useState(''), [notes, setNotes] = useState(''), [files, setFiles] = useState([]), [error, setError] = useState(''), [busy, setBusy] = useState(false), [drag, setDrag] = useState(false);
  const input = useRef(null);
  const previews = files.map(f => URL.createObjectURL(f));
  useEffect(() => () => previews.forEach(URL.revokeObjectURL), [files]); // eslint-disable-line
  useEffect(() => { if (!open) { setName(''); setNotes(''); setFiles([]); setError(''); } }, [open]);
  const add = list => setFiles(f => [...f, ...[...list].filter(x => x.type.startsWith('image/'))].slice(0, 5));
  const save = async () => {
    setError('');
    if (!/^[a-zA-Z0-9_-]+$/.test(name.trim())) return setError('Use letters, numbers, hyphens or underscores for the name.');
    if (!files.length) return setError('Add one to five clear photos of the model.');
    setBusy(true);
    try {
      const ids = []; for (const f of files) ids.push((await upload(f)).id);
      await api('/api/profiles', {name: name.trim(), images: ids, notes});
      await refresh(); setDraft({profile: name.trim()}); toast(`Model “${name.trim()}” saved.`, 'success'); close();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };
  return (
    <Modal open={open} onOpenChange={o => !o && close()} title="Add a model" description="Save the influencer once and reuse them for every reference."
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save model</Button></>}>
      <Field label="Model name" htmlFor="model-name"><input id="model-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. model-2" autoComplete="off" /></Field>
      <Field label="Photos" hint="Clear, well-lit photos — one front-on and one three-quarter work best.">
        <div className={'drop mini' + (drag ? ' over' : '')} onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}>
          {previews.map((src, i) => <div className="thumb" key={src}><img src={src} alt={`Model photo ${i + 1}`} /><button type="button" aria-label="Remove photo" onClick={() => setFiles(f => f.filter((_, j) => j !== i))}><X size={12} /></button></div>)}
          {files.length < 5 && <button type="button" className="thumb add" onClick={() => input.current.click()}><ImagePlus size={18} /><span>Add</span></button>}
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={e => { add(e.target.files); e.target.value = ''; }} />
        </div>
      </Field>
      <Field label="Details to keep" aside="optional" htmlFor="model-notes"><textarea id="model-notes" rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Identity or clothing notes" /></Field>
      {error && <p className="form-error" role="alert">{error}</p>}
    </Modal>
  );
}
