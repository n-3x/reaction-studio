import * as T from '@radix-ui/react-tabs';
import {cn} from './utils.js';

export const Tabs = ({className, ...props}) => <T.Root data-slot="tabs" className={cn('flex flex-col gap-2', className)} {...props} />;
export const TabsList = ({className, ...props}) => <T.List data-slot="tabs-list" className={cn('inline-flex h-9 w-fit items-center justify-center rounded-lg bg-muted p-[3px] text-muted-foreground', className)} {...props} />;
export const TabsTrigger = ({className, ...props}) => <T.Trigger data-slot="tabs-trigger" className={cn('inline-flex h-full flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent px-2 py-1 text-[13px] font-medium text-muted-foreground transition-[color,box-shadow] outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm dark:data-[state=active]:border-input dark:data-[state=active]:bg-input/30', className)} {...props} />;
export const TabsContent = ({className, ...props}) => <T.Content data-slot="tabs-content" className={cn('flex-1 outline-none', className)} {...props} />;
