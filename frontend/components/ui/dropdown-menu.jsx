import * as M from '@radix-ui/react-dropdown-menu';
import {cn} from './utils.js';

export const DropdownMenu = props => <M.Root data-slot="dropdown-menu" {...props} />;
export const DropdownMenuTrigger = props => <M.Trigger data-slot="dropdown-menu-trigger" {...props} />;

export function DropdownMenuContent({className, sideOffset = 6, ...props}) {
  return (
    <M.Portal>
      <M.Content data-slot="dropdown-menu-content" sideOffset={sideOffset} collisionPadding={12}
        className={cn('z-[120] max-h-(--radix-dropdown-menu-content-available-height) min-w-[11rem] overflow-x-hidden overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2', className)}
        {...props} />
    </M.Portal>
  );
}

export function DropdownMenuItem({className, variant = 'default', ...props}) {
  return <M.Item data-slot="dropdown-menu-item" data-variant={variant}
    className={cn("relative flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-[13px] outline-hidden select-none no-underline focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground", className)}
    {...props} />;
}

export const DropdownMenuLabel = ({className, ...props}) => <M.Label data-slot="dropdown-menu-label" className={cn('px-2 py-1.5 text-xs font-medium text-muted-foreground', className)} {...props} />;
export const DropdownMenuSeparator = ({className, ...props}) => <M.Separator data-slot="dropdown-menu-separator" className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />;
export const DropdownMenuShortcut = ({className, ...props}) => <span data-slot="dropdown-menu-shortcut" className={cn('ml-auto text-xs tracking-widest text-muted-foreground', className)} {...props} />;
