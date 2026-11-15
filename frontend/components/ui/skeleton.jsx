import {cn} from './utils.js';

export const Skeleton = ({className, ...props}) => <div data-slot="skeleton" aria-hidden="true" className={cn('animate-pulse rounded-md bg-accent', className)} {...props} />;
