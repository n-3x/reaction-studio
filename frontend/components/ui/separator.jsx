import * as S from '@radix-ui/react-separator';
import {cn} from './utils.js';

export const Separator = ({className, orientation = 'horizontal', decorative = true, ...props}) => (
  <S.Root data-slot="separator" decorative={decorative} orientation={orientation}
    className={cn('shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px', className)} {...props} />
);
