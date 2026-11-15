import {AlertCircle, Archive, ArchiveRestore, Check, Clapperboard, Copy, FolderOpen, Keyboard, Loader2, Menu as MenuIcon, Moon, MoreHorizontal, Plug, Plus, Search, Settings, Sun, SunMoon, X} from 'lucide-react';
import {useEffect, useMemo, useRef, useState} from 'react';
import {computePrimary, projectAction, renameProject, runPrimary} from '../actions.js';
import {ATTENTION, STEPS, STEP_LABELS, actualStep, isBusyStep, stepAvailable} from '../lib.js';
import {useJob, useStudio} from '../store.js';
import {Input} from './ui/input.jsx';
import {Badge, Button, IconButton, Menu, MenuItem, MenuLabel, MenuSep, Segmented, Skeleton, Spinner, cn} from './ui.jsx';

export const APP_NAME = 'Content Tool';

function statusTone(job) {
  if (!job) return 'neutral';
  if (job.step === 'complete') return 'success';
  if (job.step === 'error') return 'danger';
  if (ATTENTION.includes(job.step)) return 'warn';
  if (isBusyStep(job.step) || job.busy) return 'info';
  return 'neutral';
}
const DOT = {success: 'bg-success', danger: 'bg-destructive', warn: 'bg-warning', info: 'bg-primary', neutral: 'bg-muted-foreground/50'};

export function Sidebar() {
  const data = useStudio(s => s.data), selectedId = useStudio(s => s.selectedId), open = useStudio(s => s.sidebarOpen), theme = useStudio(s => s.theme);
  const {selectJob, newProject, setSidebar, openDialog, setTheme} = useStudio.getState();
  const [query, setQuery] = useState(''), [archived, setArchived] = useState(false);
  const jobs = useMemo(() => (data?.jobs || []).filter(j => Boolean(j.archived) === archived && (j.title + ' ' + j.profile).toLowerCase().includes(query.toLowerCase())), [data, query, archived]);
  const chat = data?.settings.chatgpt, video = data?.settings.video_ready, vpName = data?.settings.video_provider === 'aimlapi' ? 'AIMLAPI' : 'fal';
  const chatOk = Boolean(chat && (chat.app_signed_in || chat.system_signed_in));
  const allOk = chatOk && video;
  const search = useRef(null);
  useEffect(() => { if (open) search.current?.focus(); }, [open]);

  return (
    <aside id="sidebar" aria-label="Projects"
      className={cn('sidebar flex min-h-0 min-w-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground',
        'max-[940px]:fixed max-[940px]:inset-y-0 max-[940px]:left-0 max-[940px]:z-[90] max-[940px]:w-[288px] max-[940px]:shadow-2xl max-[940px]:transition-transform max-[940px]:duration-200',
        open ? 'max-[940px]:translate-x-0' : 'max-[940px]:-translate-x-[102%]')}>
      <div className="flex h-14 shrink-0 items-center gap-2.5 px-4">
        <span className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm" aria-hidden="true"><Clapperboard size={15} /></span>
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="text-sm font-semibold tracking-tight">{APP_NAME}</span>
          <span className="text-[11px] text-muted-foreground">Local workspace</span>
        </div>
        <IconButton className="ml-auto min-[941px]:hidden" label="Close projects" icon={X} onClick={() => setSidebar(false)} />
      </div>

      <div className="flex flex-col gap-2.5 px-3 pb-3">
        <Button variant="primary" className="w-full" icon={Plus} onClick={newProject}>New project</Button>
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <label className="sr-only" htmlFor="project-search">Search projects</label>
          <Input ref={search} id="project-search" type="search" placeholder="Search projects…" value={query} onChange={e => setQuery(e.target.value)} className="h-8 pl-8 text-[13px]" />
        </div>
        <Segmented size="md" label="Project filter" value={archived ? 'archived' : 'recent'} onChange={v => setArchived(v === 'archived')}
          options={[{value: 'recent', label: 'Recent'}, {value: 'archived', label: 'Archived'}]} />
      </div>

      <div className="flex items-center justify-between px-5 pt-1 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        <span>{archived ? 'Archived' : 'Projects'}</span>{data && <span className="tabular-nums">{jobs.length}</span>}
      </div>
      <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2" aria-label="Saved projects">
        {!data && [0, 1, 2, 3].map(i => <Skeleton key={i} className="mx-1 mb-1 h-[52px]" />)}
        {data && jobs.map(job => {
          const profile = data.profiles.find(p => p.name === job.profile), thumb = job.media.image || job.media.frame || profile?.images[0];
          const tone = statusTone(job), on = selectedId === job.id, busy = tone === 'info';
          return (
            <button key={job.id} type="button" aria-current={on ? 'true' : undefined} onClick={() => selectJob(job.id)}
              className={cn('group flex w-full min-w-0 items-center gap-3 rounded-lg px-2 py-1.5 text-left outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/40',
                on ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/60')}>
              {thumb ? <img className="h-11 w-8 shrink-0 rounded-md bg-muted object-cover ring-1 ring-border" src={thumb} alt="" loading="lazy" /> : <span className="h-11 w-8 shrink-0 rounded-md bg-muted ring-1 ring-border" />}
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className={cn('truncate text-[13px]', on ? 'font-semibold' : 'font-medium')} title={job.title}>{job.title}</span>
                <span className={cn('flex items-center gap-1.5 truncate text-[11px]', busy ? 'text-brand' : 'text-muted-foreground')}>
                  {busy ? <Spinner size={10} /> : <i className={cn('size-1.5 shrink-0 rounded-full', DOT[tone])} />}
                  {STEP_LABELS[job.step] || job.step} · {new Date(job.created_at).toLocaleDateString([], {month: 'short', day: 'numeric'})}
                </span>
              </span>
            </button>
          );
        })}
        {data && !jobs.length && (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-xs text-muted-foreground">
            <FolderOpen size={20} className="opacity-60" aria-hidden="true" />
            {query ? 'No matching projects.' : archived ? 'Nothing archived yet.' : 'Your projects will appear here.'}
          </div>
        )}
      </nav>

      <div className="flex shrink-0 items-center gap-1 border-t border-sidebar-border p-2">
        <button type="button" onClick={() => openDialog('connections')}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-[3px] focus-visible:ring-ring/40">
          <Plug size={15} className="text-muted-foreground" aria-hidden="true" />
          <span className="font-medium">Connections</span>
          <span className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground" aria-label={`ChatGPT ${chatOk ? 'connected' : 'not connected'}, ${vpName} ${video ? 'connected' : 'key needed'}`}>
            <i className={cn('size-1.5 rounded-full', allOk ? 'bg-success' : 'bg-warning')} />{allOk ? 'Ready' : 'Setup'}
          </span>
        </button>
        <Menu side="top" trigger={<IconButton label="Settings" icon={Settings} />}>
          <MenuLabel>Appearance</MenuLabel>
          {[['system', 'Match system', SunMoon], ['dark', 'Dark', Moon], ['light', 'Light', Sun]].map(([v, l, I]) => <MenuItem key={v} icon={I} hint={theme === v ? '✓' : ''} onSelect={() => setTheme(v)}>{l}</MenuItem>)}
          <MenuSep />
          <MenuItem icon={Keyboard} hint="?" onSelect={() => openDialog('shortcuts')}>Keyboard shortcuts</MenuItem>
        </Menu>
      </div>
    </aside>
  );
}

export function Header() {
  const job = useJob(), connected = useStudio(s => s.connected);
  const {setSidebar} = useStudio.getState();
  const [title, setTitle] = useState(job?.title || '');
  useEffect(() => setTitle(job?.title || useStudio.getState().draft.title || ''), [job?.id, job?.title]);
  const label = job ? STEP_LABELS[job.step] || job.step : 'Draft';
  const commit = () => { if (!job) { useStudio.getState().setDraft({title}); return; } if (!title.trim()) { setTitle(job.title); return; } renameProject(title); };
  const saveText = !connected ? 'Server disconnected' : !job ? 'Not saved yet' : job.busy ? 'Working · saved locally' : title.trim() !== job.title ? 'Unsaved title' : 'Saved locally';

  return (
    <header className="topbar flex h-14 shrink-0 items-center gap-3 border-b bg-background px-5 max-[940px]:px-3">
      <IconButton className="min-[941px]:hidden" label="Open projects" icon={MenuIcon} onClick={() => setSidebar(true)} aria-controls="sidebar" />
      <div className="flex min-w-0 flex-col justify-center max-[940px]:flex-1 min-[941px]:max-w-[46%]">
        <label className="sr-only" htmlFor="project-title">Project title. Saves when you leave the field.</label>
        <input id="project-title" value={title} maxLength={120} placeholder="Untitled project"
          className="-ml-1.5 h-7 w-full min-w-0 truncate rounded-md border border-transparent bg-transparent px-1.5 text-[15px] font-semibold tracking-tight outline-none transition-colors placeholder:text-muted-foreground hover:border-input focus:border-ring focus:bg-muted/50 focus:ring-[3px] focus:ring-ring/25"
          onChange={e => setTitle(e.target.value)} onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setTitle(job?.title || ''); e.currentTarget.blur(); } }} />
        <span className={cn('text-[11px] leading-tight', connected ? 'text-muted-foreground' : 'text-destructive')}>{saveText}</span>
      </div>
      <Badge tone={statusTone(job)} dot>{label}</Badge>
      <span className="flex-1" />
      {job && (
        <Menu trigger={<IconButton label="Project actions" icon={MoreHorizontal} />}>
          <MenuItem icon={Copy} disabled={job.busy} onSelect={() => projectAction('revise', {request_key: crypto.randomUUID()})}>Duplicate setup</MenuItem>
          <MenuItem icon={job.archived ? ArchiveRestore : Archive} disabled={job.busy} onSelect={() => projectAction('archive', {archived: !job.archived})}>{job.archived ? 'Restore project' : 'Archive project'}</MenuItem>
        </Menu>
      )}
    </header>
  );
}

export function Stepper() {
  const job = useJob(), view = useStudio(s => s.viewStep), setStep = useStudio(s => s.setStep);
  const active = actualStep(job), activeIndex = STEPS.findIndex(s => s.id === active);
  const busyStep = job?.busy || isBusyStep(job?.step) ? active : null;
  return (
    <nav className="stepper shrink-0 overflow-x-auto [scrollbar-width:none] border-b bg-background px-4 max-[940px]:px-2" aria-label="Creation workflow">
      <ol className="flex min-w-max items-center py-2">
        {STEPS.map((step, i) => {
          const available = stepAvailable(step.id, job), current = view === step.id;
          const done = (job && i < activeIndex) || (step.id === 'export' && job?.step === 'complete');
          const busy = busyStep === step.id, attn = job && !busy && active === step.id && ATTENTION.includes(job.step);
          return (
            <li key={step.id} className={cn('flex items-center', current && 'current')}>
              {i > 0 && <span className={cn('mx-1 h-px w-[clamp(12px,2.5vw,36px)]', i <= activeIndex && job ? 'bg-primary/60' : 'bg-border')} aria-hidden="true" />}
              <button type="button" disabled={!available} aria-current={current ? 'step' : undefined} onClick={() => setStep(step.id)}
                className={cn('relative flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-45',
                  current ? 'bg-accent text-foreground' : 'text-muted-foreground enabled:hover:bg-accent/60 enabled:hover:text-foreground')}>
                <span className={cn('grid size-6 shrink-0 place-items-center rounded-full border text-[11px] font-semibold tabular-nums transition-colors',
                  current ? 'border-primary bg-primary text-primary-foreground ring-4 ring-primary/15' : done ? 'border-primary/40 bg-primary/15 text-brand' : 'border-input bg-background')}>
                  {busy ? <Loader2 size={13} className="spin" /> : done && !current ? <Check size={13} strokeWidth={3} /> : attn && job.step === 'error' ? <AlertCircle size={13} /> : i + 1}
                </span>
                <span className="flex flex-col leading-tight max-[760px]:[li:not(.current)_&]:hidden">
                  <b className="text-[13px] font-medium">{step.label}</b>
                  <small className="text-[11px] text-muted-foreground max-[1180px]:hidden">{step.hint}</small>
                </span>
                {attn && <i className="absolute top-1 right-1 size-2 rounded-full bg-warning ring-2 ring-background" aria-label="Needs your review" />}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// Inspector footer: one primary action, always in the same place.
export function PrimaryFooter({custom}) {
  const state = useStudio();
  const p = custom || computePrimary(state);
  return (
    <footer className="inspector-foot">
      {p.progress && <p className="mb-3 text-xs leading-relaxed text-muted-foreground" role="status" aria-live="polite">{p.progress}</p>}
      <Button variant="primary" size="lg" className="w-full" disabled={p.disabled} loading={p.busy} onClick={custom ? p.onClick : runPrimary}>{p.label}</Button>
      {p.note && <p className="mt-2 text-center text-[11px] text-muted-foreground">{p.note}</p>}
    </footer>
  );
}
