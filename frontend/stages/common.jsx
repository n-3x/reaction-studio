import {Download, Expand, Minimize2} from 'lucide-react';
import {downloadUrl} from '../lib.js';
import {useJob, useStudio} from '../store.js';
import {IconButton, Menu, MenuItem, MenuLabel} from '../components/ui.jsx';
import {PrimaryFooter} from '../components/Shell.jsx';
import clsx from 'clsx';

const FILES = [['reference', 'Motion input'], ['frame', 'Reference frame'], ['image', 'Starting image'], ['generated', 'Raw generated motion'], ['hook', 'Hook MP4 · 3 seconds'], ['audio', 'Full original reel audio'], ['soundtrack', 'Soundtrack with volume applied'], ['assembly', 'Edited final video'], ['final', 'Previous assembled video'], ['bundle', 'Project assets ZIP']];

export function DownloadsMenu() {
  const job = useJob();
  const items = FILES.filter(([k]) => job?.media[k]);
  if (!items.length) return null;
  return (
    <Menu trigger={<IconButton label="Download files" icon={Download} />}>
      <MenuLabel>Download</MenuLabel>
      {items.map(([k, label]) => <MenuItem key={k} href={downloadUrl(job.media[k])}>{label}</MenuItem>)}
    </Menu>
  );
}

export function StageHeader({title, meta, children}) {
  const focus = useStudio(s => s.focusMode), setFocus = useStudio(s => s.setFocusMode);
  return (
    <div className="stage-head">
      <div><h1>{title}</h1>{meta && <p>{meta}</p>}</div>
      <div className="stage-tools">{children}<DownloadsMenu />
        <IconButton label={focus ? 'Exit focus view' : 'Focus on preview'} icon={focus ? Minimize2 : Expand} active={focus} onClick={() => setFocus(!focus)} /></div>
    </div>
  );
}

export function Workspace({stage, inspector, footer, wide, className}) {
  const focus = useStudio(s => s.focusMode);
  return (
    <div className={clsx('workspace', focus && 'is-focus', wide && 'is-wide', className)}>
      <section className="stage" aria-label="Preview workspace">{stage}</section>
      <aside className="inspector" aria-label="Step controls">
        <div className="inspector-scroll">{inspector}</div>
        {footer ?? <PrimaryFooter />}
      </aside>
    </div>
  );
}
