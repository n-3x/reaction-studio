import {forwardRef} from 'react';
import {cn} from './utils.js';

export const inputClass = 'flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-[13px] shadow-xs transition-[color,box-shadow,border-color] outline-none placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 aria-invalid:border-destructive aria-invalid:ring-destructive/20';

export const Input = forwardRef(function Input({className, type, ...props}, ref) {
  return <input ref={ref} type={type} data-slot="input" className={cn(inputClass, className)} {...props} />;
});

export const Textarea = forwardRef(function Textarea({className, ...props}, ref) {
  return <textarea ref={ref} data-slot="textarea" className={cn(inputClass, 'h-auto min-h-20 py-2 leading-relaxed', className)} {...props} />;
});

export function Label({className, ...props}) {
  return <label data-slot="label" className={cn('flex select-none items-center gap-2 text-[13px] font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50', className)} {...props} />;
}
