// App-level UI kit. Thin wrappers over the shadcn/ui primitives in ./ui/ that keep the props the stages already use.
import {AlertTriangle, Check, CheckCircle2, ChevronDown, Info, Loader2, X} from 'lucide-react';
import {forwardRef} from 'react';
import {useStudio} from '../store.js';
import {Badge as BadgeBase} from './ui/badge.jsx';
import {Button as ButtonBase} from './ui/button.jsx';
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from './ui/dialog.jsx';
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger} from './ui/dropdown-menu.jsx';
import {Kbd as KbdBase} from './ui/kbd.jsx';
import {Label} from './ui/input.jsx';
import {Switch} from './ui/switch.jsx';
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from './ui/tooltip.jsx';
import {cn} from './ui/utils.js';

export {cn};

export const Spinner = ({size = 16, className}) => <Loader2 size={size} className={cn('spin', className)} aria-hidden="true" />;

const VARIANTS = {primary: 'default', secondary: 'outline', ghost: 'ghost', danger: 'destructive', outline: 'outline'};
const SIZES = {md: 'default', sm: 'sm', lg: 'lg'};

export const Button = forwardRef(function Button({variant = 'secondary', size = 'md', icon: Icon, loading, children, className, ...props}, ref) {
  const danger = className?.split(' ').includes('danger');
  return (
    <ButtonBase ref={ref} type="button" {...props} disabled={props.disabled || loading} variant={VARIANTS[variant] || variant} size={SIZES[size] || size}
      className={cn(danger && 'text-destructive hover:text-destructive hover:bg-destructive/10', className)}>
      {loading ? <Spinner size={15} /> : Icon ? <Icon size={size === 'sm' ? 14 : 16} aria-hidden="true" /> : null}
      {children}
    </ButtonBase>
  );
});

export const IconButton = forwardRef(function IconButton({label, icon: Icon, size = 16, active, tip = true, className, shortcut, ...props}, ref) {
  const button = (
    <button ref={ref} type="button" aria-label={label} {...props}
      className={cn('icon-btn inline-flex size-8 shrink-0 items-center justify-center rounded-md text-(--icon-fg) outline-none transition-colors hover:bg-(--icon-bg-hover) hover:text-(--icon-fg-hover) focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-40',
        active && 'bg-primary/15 text-brand hover:bg-primary/20 hover:text-brand', className)}>
      <Icon size={size} aria-hidden="true" />
    </button>
  );
  return tip ? <Tip label={label} shortcut={shortcut}>{button}</Tip> : button;
});

export function Tip({label, shortcut, children, side = 'top'}) {
  if (!label) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{label}{shortcut && <KbdBase>{shortcut}</KbdBase>}</TooltipContent>
    </Tooltip>
  );
}
export const TipProvider = ({children}) => <TooltipProvider delayDuration={350}>{children}</TooltipProvider>;

export function Modal({open, onOpenChange, title, description, children, width = 460, footer}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent style={{maxWidth: `min(${width}px, calc(100% - 2rem))`}} className="gap-5">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className={description ? undefined : 'sr-only'}>{description || title}</DialogDescription>
        </DialogHeader>
        <div className="min-w-0">{children}</div>
        {footer && <DialogFooter className="-mx-6 -mb-6 border-t bg-muted/40 px-6 py-4">{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}

export function Menu({trigger, children, align = 'end', side = 'bottom'}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align={align} side={side}>{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}
export const MenuItem = ({icon: Icon, children, danger, onSelect, href, download, disabled, hint}) => {
  const body = <>{Icon && <Icon size={15} aria-hidden="true" />}<span className="flex-1">{children}</span>
    {hint === '✓' ? <Check size={14} className="text-brand" aria-label="Selected" /> : hint && <span className="ml-auto text-xs text-muted-foreground">{hint}</span>}</>;
  return (
    <DropdownMenuItem variant={danger ? 'destructive' : 'default'} onSelect={onSelect} disabled={disabled} asChild={Boolean(href)}>
      {href ? <a href={href} download={download ?? ''}>{body}</a> : body}
    </DropdownMenuItem>
  );
};
export const MenuLabel = ({children}) => <DropdownMenuLabel>{children}</DropdownMenuLabel>;
export const MenuSep = () => <DropdownMenuSeparator />;

// Segmented control styled like shadcn Tabs. Colours come from --seg-* variables so dark-canvas contexts can override them.
export function Segmented({value, onChange, options, label, size = 'md', disabled}) {
  return (
    <div role="radiogroup" aria-label={label}
      className={cn('segmented flex items-center gap-0.5 rounded-lg bg-(--seg-bg,var(--muted)) p-[3px]', size === 'sm' ? 'w-fit' : 'w-full')}>
      {options.map(o => {
        const on = value === o.value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} disabled={disabled || o.disabled} onClick={() => onChange(o.value)}
            className={cn('inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium outline-none transition-[color,background-color,box-shadow] focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-40',
              size === 'sm' ? 'h-6 px-2.5 text-xs' : 'h-7 px-3 text-[13px]',
              on ? 'bg-(--seg-on,var(--background)) text-(--seg-on-fg,var(--foreground)) shadow-sm dark:bg-(--seg-on,var(--accent))' : 'text-(--seg-fg,var(--muted-foreground)) hover:text-(--seg-on-fg,var(--foreground))')}>
            {o.icon && <o.icon size={14} aria-hidden="true" />}{o.label}
          </button>
        );
      })}
    </div>
  );
}

export const Field = ({label, hint, children, htmlFor, aside}) => (
  <div className="field">
    {label && <div className="mb-2 flex items-baseline justify-between gap-2"><Label htmlFor={htmlFor} className="text-xs">{label}</Label>{aside && <span className="text-[11px] text-muted-foreground tabular-nums">{aside}</span>}</div>}
    {children}
    {hint && <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{hint}</p>}
  </div>
);

const TONES = {neutral: 'secondary', success: 'success', warn: 'warning', danger: 'destructive', info: 'info'};
export const Badge = ({tone = 'neutral', children, dot, className}) => (
  <BadgeBase variant={TONES[tone] || 'secondary'} className={className}>{dot && <i className="size-1.5 rounded-full bg-current" aria-hidden="true" />}{children}</BadgeBase>
);

// Labeled switch row (replaces bare checkboxes).
export function SwitchRow({checked, onChange, disabled, title, description, id}) {
  const sid = id || 'sw-' + String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return (
    <div className="mt-3 flex items-start justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2.5">
      <label htmlFor={sid} className="min-w-0 cursor-pointer text-[13px] font-medium leading-snug">{title}{description && <small className="mt-0.5 block text-xs font-normal text-muted-foreground">{description}</small>}</label>
      <Switch id={sid} checked={checked} disabled={disabled} onCheckedChange={onChange} className="mt-0.5" />
    </div>
  );
}

export function Disclosure({title, meta, children, defaultOpen = false, open, onToggle}) {
  return (
    <details className="disclosure group" open={open ?? defaultOpen} onToggle={onToggle}>
      <summary><span>{title}</span>{meta && <span className="disclosure-meta">{meta}</span>}<ChevronDown size={15} className="chev" aria-hidden="true" /></summary>
      <div className="disclosure-body">{children}</div>
    </details>
  );
}

const CALLOUT = {
  info: 'border-primary/20 bg-primary/[0.06] [&>svg]:text-brand',
  warn: 'border-warning/25 bg-warning/[0.07] [&>svg]:text-warning',
  error: 'border-destructive/25 bg-destructive/[0.07] [&>svg]:text-destructive',
  success: 'border-success/25 bg-success/[0.07] [&>svg]:text-success',
};
export function Callout({tone = 'info', title, children, actions, icon}) {
  const Icon = icon || (tone === 'error' || tone === 'warn' ? AlertTriangle : tone === 'success' ? CheckCircle2 : Info);
  return (
    <div className={cn('callout mb-3.5 flex gap-2.5 rounded-lg border px-3 py-2.5 text-[13px] leading-relaxed', CALLOUT[tone] || CALLOUT.info)} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 text-muted-foreground">
        {title && <strong className="block font-medium text-foreground">{title}</strong>}
        {children && <div>{children}</div>}
        {actions && <div className="mt-2.5 flex flex-wrap gap-1.5">{actions}</div>}
      </div>
    </div>
  );
}

export const Kbd = ({children}) => <KbdBase>{children}</KbdBase>;

export function Toasts() {
  const toasts = useStudio(s => s.toasts), dismiss = useStudio(s => s.dismissToast);
  return (
    <div className="fixed right-4 bottom-4 z-[150] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2" role="region" aria-label="Notifications" aria-live="polite">
      {toasts.map(t => (
        <div key={t.id} role={t.kind === 'error' ? 'alert' : 'status'}
          className="flex items-start gap-2.5 rounded-lg border bg-popover px-3.5 py-3 text-[13px] text-popover-foreground shadow-lg animate-in fade-in-0 slide-in-from-bottom-2">
          {t.kind === 'error' ? <AlertTriangle size={16} className="mt-0.5 shrink-0 text-destructive" /> : t.kind === 'success' ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" /> : <Info size={16} className="mt-0.5 shrink-0 text-brand" />}
          <span className="flex-1">{t.text}</span>
          <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground"><X size={14} /></button>
        </div>
      ))}
    </div>
  );
}

export const Skeleton = ({className, style}) => <div className={cn('skeleton', className)} style={style} aria-hidden="true" />;
