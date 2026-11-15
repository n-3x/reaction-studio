import {cva} from 'class-variance-authority';
import {cn} from './utils.js';

export const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium [&>svg]:size-3 [&>svg]:pointer-events-none',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'text-foreground',
        success: 'border-success/25 bg-success/10 text-success',
        warning: 'border-warning/25 bg-warning/10 text-warning',
        destructive: 'border-destructive/25 bg-destructive/10 text-destructive',
        info: 'border-primary/25 bg-primary/10 text-brand',
      },
    },
    defaultVariants: {variant: 'default'},
  },
);

export function Badge({className, variant, ...props}) {
  return <span data-slot="badge" className={cn(badgeVariants({variant}), className)} {...props} />;
}
