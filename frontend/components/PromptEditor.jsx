import {BookmarkPlus, Check, Trash2} from 'lucide-react';
import {useMemo, useState} from 'react';
import {flushPrompts, saveProjectPrompt, saveTemplate, toastError} from '../actions.js';
import {useStudio} from '../store.js';
import {Button, Disclosure, Field} from './ui.jsx';

export function PromptEditor({kind, locked, label, hint, rows = 8, placeholder}) {
  const data = useStudio(s => s.data), value = useStudio(s => kind === 'image' ? s.draft.imagePrompt : s.draft.motionPrompt), setDraft = useStudio(s => s.setDraft);
  const [picked, setPicked] = useState(''), [name, setName] = useState(''), [status, setStatus] = useState('');
  const saved = useMemo(() => (data?.saved_prompts || []).filter(p => p.kind === kind), [data, kind]);
  const field = kind === 'image' ? 'imagePrompt' : 'motionPrompt';
  const defaultText = kind === 'image' ? data?.default_image_prompt : data?.default_motion_prompt;
  const entry = saved.find(p => p.id === picked);

  const load = id => {
    setPicked(id); if (!id) return;
    const e = saved.find(p => p.id === id);
    setDraft({[field]: e?.text ?? defaultText ?? ''}); setName(e?.name || ''); setStatus('Loaded. Edit before using.');
    setTimeout(() => saveProjectPrompt(kind), 0);
  };
  const run = async action => {
    try {
      const e = await saveTemplate(kind, action, {id: picked, name, text: value});
      if (action === 'delete') { setPicked(''); setStatus('Saved prompt deleted. Your project text is kept.'); }
      else { setPicked(e.id); setStatus('Saved on this Mac.'); }
    } catch (error) { setStatus(error.message); }
  };

  return (
    <div className="prompt">
      <Field label="Saved prompts" htmlFor={kind + '-saved'}>
        <select id={kind + '-saved'} value={picked} disabled={locked} onChange={e => load(e.target.value)}>
          <option value="">Choose a saved prompt…</option><option value="default">Default prompt</option>
          {saved.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </Field>
      <Field label={label} htmlFor={kind + '-prompt'} hint={hint} aside={<span className="count">{value.length.toLocaleString()} chars</span>}>
        <textarea id={kind + '-prompt'} rows={rows} value={value} readOnly={locked} placeholder={placeholder} spellCheck="true"
          onChange={e => setDraft({[field]: e.target.value})} onBlur={() => saveProjectPrompt(kind)} />
      </Field>
      <Disclosure title="Save or manage prompts">
        <Field label="Prompt name" htmlFor={kind + '-name'}><input id={kind + '-name'} maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Natural reaction" /></Field>
        <div className="row-actions">
          <Button size="sm" icon={BookmarkPlus} disabled={!value.trim() || !name.trim()} onClick={() => run('save')}>Save new</Button>
          <Button size="sm" icon={Check} disabled={!entry} onClick={() => run('update')}>Update</Button>
          <Button size="sm" variant="ghost" icon={Trash2} disabled={!entry} onClick={() => run('delete')}>Delete</Button>
        </div>
        {status && <p className="hint" role="status">{status}</p>}
      </Disclosure>
    </div>
  );
}
