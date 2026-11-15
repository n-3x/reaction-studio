import {Check, Film, Plus, Search, Upload} from 'lucide-react';
import {useMemo, useState} from 'react';
import {pickFile, toastError} from '../actions.js';
import {upload} from '../api.js';
import {secs, stripUrl} from '../lib.js';
import {useStudio} from '../store.js';
import {Button, Modal} from './ui.jsx';

export function ClipLibrary({open, onOpenChange, onAdd, counts}) {
  const data = useStudio(s => s.data);
  const [query, setQuery] = useState(''), [status, setStatus] = useState(''), [over, setOver] = useState(false);
  const sources = useMemo(() => {
    const list = [];
    for (const job of data?.jobs || []) { const media = job.media.hook ? 'hook' : job.media.generated ? 'generated' : null; if (media) list.push({key: 'j' + job.id, source: {kind: 'job', id: job.id, media}, name: job.title, duration: media === 'hook' ? 3 : job.generated_seconds, type: 'Reaction', url: job.media[media]}); }
    for (const a of (data?.assets || []).filter(a => a.kind === 'video')) list.push({key: 'a' + a.id, source: {kind: 'asset', id: a.id}, name: a.name, duration: a.duration, type: 'Upload', url: a.url});
    return list.filter(s => s.name.toLowerCase().includes(query.toLowerCase()));
  }, [data, query]);

  const uploadFiles = async files => {
    for (const file of files) {
      try { setStatus(`Uploading ${file.name}…`); const up = await upload(file); if (up.kind !== 'video') throw new Error('Choose video files.'); onAdd({kind: 'asset', id: up.id}); }
      catch (e) { toastError(e); break; }
    }
    setStatus('');
  };
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Add to sequence" description="Saved reactions and uploaded videos. Originals are never changed." width={560}
      footer={<><span className="grow hint">{status}</span><Button variant="primary" onClick={() => onOpenChange(false)}>Done</Button></>}>
      <div className={'lib-drop' + (over ? ' over' : '')} onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={e => { e.preventDefault(); setOver(false); uploadFiles([...e.dataTransfer.files]); }}>
        <Button icon={Upload} onClick={async () => uploadFiles(await pickFile('video/mp4,video/quicktime,video/webm', true))}>Upload videos</Button>
        <span>or drop files here</span>
      </div>
      <label className="search"><Search size={14} aria-hidden="true" /><span className="sr-only">Search clips</span><input type="search" placeholder="Search saved videos" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <ul className="lib-list">
        {sources.map(s => {
          const n = counts?.(s.source) || 0;
          return (
            <li key={s.key}>
              <button type="button" onClick={() => onAdd(s.source)}>
                <span className="lib-thumb" style={{backgroundImage: `url(${stripUrl(s.url, 6, 96)})`}} aria-hidden="true" />
                <span className="lib-text"><b>{s.name}</b><small>{s.type} · {secs(s.duration)}{n ? ` · in sequence ×${n}` : ''}</small></span>
                <span className="lib-add">{n ? <Check size={15} /> : <Plus size={15} />}Add</span>
              </button>
            </li>
          );
        })}
        {!sources.length && <li className="empty"><Film size={18} /><span>No saved clips yet. Upload a video to add it.</span></li>}
      </ul>
    </Modal>
  );
}
