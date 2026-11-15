import * as T from '@radix-ui/react-tooltip';
import {cn} from './utils.js';

export const TooltipProvider = ({delayDuration = 300, ...props}) => <T.Provider data-slot="tooltip-provider" delayDuration={delayDuration} skipDelayDuration={200} {...props} />;
export const Tooltip = props => <T.Root data-slot="tooltip" {...props} />;
export const TooltipTrigger = props => <T.Trigger data-slot="tooltip-trigger" {...props} />;
export function TooltipContent({className, sideOffset = 6, children, ...props}) {
  return (
    <T.Portal>
      <T.Content data-slot="tooltip-content" sideOffset={sideOffset}
        className={cn('z-[130] flex w-fit items-center gap-2 rounded-md bg-foreground px-2.5 py-1 text-xs text-background animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95', className)}
        {...props}>{children}</T.Content>
    </T.Portal>
  );
}
