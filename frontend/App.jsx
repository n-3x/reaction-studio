import {WifiOff} from 'lucide-react';
import {useEffect} from 'react';
import {ConnectionsDialog} from './components/Connections.jsx';
import {ModelDialog} from './components/ModelDialog.jsx';
import {Header, Sidebar, Stepper} from './components/Shell.jsx';
import {Modal, Skeleton, TipProvider, Toasts} from './components/ui.jsx';
import {applyTheme, useJob, useStudio} from './store.js';
import EditStage, {Shortcuts} from './stages/EditStage.jsx';
import ExportStage from './stages/ExportStage.jsx';
import ImageStage from './stages/ImageStage.jsx';
import MotionStage from './stages/MotionStage.jsx';
import ReferenceStage from './stages/ReferenceStage.jsx';

function Stage() {
  const view = useStudio(s => s.viewStep), job = useJob(), id = job?.id || 'draft';
  switch (view) {
    case 'image': return <ImageStage key={id} />;
    case 'motion': return <MotionStage key={id} />;
    case 'edit': return <EditStage key={id} />;
    case 'export': return <ExportStage key={id} />;
    default: return <ReferenceStage key={id} />;
  }
}

function Shortcut() {
  const open = useStudio(s => s.dialog === 'shortcuts'), close = useStudio(s => s.closeDialog);
  return <Modal open={open} onOpenChange={o => !o && close()} title="Keyboard shortcuts" description="Available in the Edit step. Video players also respond to Space, ← →, J / L, M and F." width={440}><Shortcuts /></Modal>;
}

export default function App() {
  const loaded = useStudio(s => s.loaded), connected = useStudio(s => s.connected), sidebarOpen = useStudio(s => s.sidebarOpen);
  const busy = useStudio(s => s.data?.jobs.some(j => j.busy) || s.data?.settings.chatgpt?.login.state === 'pending');
  const focus = useStudio(s => s.focusMode);

  useEffect(() => { applyTheme(); useStudio.getState().refresh(true); }, []);
  useEffect(() => {
    const tick = () => { if (!document.hidden) useStudio.getState().refresh(); };
    const id = setInterval(tick, busy ? 1200 : 3000);
    const vis = () => { if (document.hidden) document.querySelectorAll('video,audio').forEach(m => m.pause()); else tick(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', vis); };
  }, [busy]);
  useEffect(() => {
    const key = e => {
      if (e.key === 'Escape') { if (useStudio.getState().sidebarOpen) useStudio.getState().setSidebar(false); else if (useStudio.getState().focusMode && !document.querySelector('[role=dialog],[role=menu]')) useStudio.getState().setFocusMode(false); }
      if (e.key === '?' && !e.target.closest?.('input,textarea,select')) useStudio.getState().openDialog('shortcuts');
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);

  return (
    <TipProvider>
      <a className="skip" href="#main">Skip to editor</a>
      <div className={'app' + (focus ? ' is-focus' : '') + (sidebarOpen ? ' side-open' : '')}>
        {!focus && <Sidebar />}
        {sidebarOpen && <div className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-[1px] min-[941px]:hidden" onClick={() => useStudio.getState().setSidebar(false)} />}
        <main id="main" className="main" inert={sidebarOpen ? '' : undefined}>
          <Header />
          {!connected && <div className="flex items-center gap-2 border-b border-destructive/20 bg-destructive/10 px-5 py-2 text-[13px] text-destructive" role="alert"><WifiOff size={14} aria-hidden="true" />Can't reach the local server. Restart Content Tool and this page reconnects automatically.</div>}
          <Stepper />
          {loaded ? <Stage /> : <div className="grid flex-1 grid-cols-[1fr_340px] gap-4 p-4 max-[760px]:grid-cols-1"><Skeleton className="h-full rounded-xl" /><Skeleton className="h-full rounded-xl max-[760px]:hidden" /></div>}
        </main>
      </div>
      <ConnectionsDialog /><ModelDialog /><Shortcut /><Toasts />
    </TipProvider>
  );
}
