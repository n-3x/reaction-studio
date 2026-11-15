import * as DialogPrimitive from '@radix-ui/react-dialog';
import {XIcon} from 'lucide-react';
import {cn} from './utils.js';

export const Dialog = props => <DialogPrimitive.Root data-slot="dialog" {...props} />;
export const DialogTrigger = props => <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
export const DialogClose = props => <DialogPrimitive.Close data-slot="dialog-close" {...props} />;

export function DialogOverlay({className, ...props}) {
  return <DialogPrimitive.Overlay data-slot="dialog-overlay" className={cn('fixed inset-0 z-[100] bg-black/60 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0', className)} {...props} />;
}

export function DialogContent({className, children, showCloseButton = true, ...props}) {
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content data-slot="dialog-content"
        className={cn('fixed top-[50%] left-[50%] z-[101] grid max-h-[calc(100dvh-2.5rem)] w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 overflow-y-auto rounded-xl border bg-popover text-popover-foreground p-6 shadow-2xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 sm:max-w-lg', className)}
        {...props}>
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close className="absolute top-4 right-4 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 outline-none">
            <XIcon className="size-4" /><span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export const DialogHeader = ({className, ...props}) => <div data-slot="dialog-header" className={cn('flex flex-col gap-1.5 pr-8 text-left', className)} {...props} />;
export const DialogFooter = ({className, ...props}) => <div data-slot="dialog-footer" className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />;
export const DialogTitle = ({className, ...props}) => <DialogPrimitive.Title data-slot="dialog-title" className={cn('text-base leading-none font-semibold tracking-tight', className)} {...props} />;
export const DialogDescription = ({className, ...props}) => <DialogPrimitive.Description data-slot="dialog-description" className={cn('text-[13px] text-muted-foreground', className)} {...props} />;
