import {cn} from './utils.js';

export const Kbd = ({className, ...props}) => <kbd data-slot="kbd" className={cn('pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-sm bg-muted px-1 font-sans text-[11px] font-medium text-muted-foreground select-none [[data-slot=tooltip-content]_&]:bg-background/20 [[data-slot=tooltip-content]_&]:text-background', className)} {...props} />;
