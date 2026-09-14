import { AIC, cx } from './cx'

export type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg'

const SIZES: Record<SpinnerSize, string> = {
  xs: 'w-3 h-3 border-2',
  sm: 'w-4 h-4 border-2',
  md: 'w-5 h-5 border-2',
  lg: 'w-8 h-8 border-4',
}

export interface SpinnerProps {
  size?: SpinnerSize
  className?: string
  label?: string
}

export function Spinner({ size = 'md', className, label }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={label ?? 'Loading'}
      className={cx(
        AIC,
        'inline-block rounded-full border-primary border-t-transparent animate-spin align-middle',
        SIZES[size],
        className,
      )}
    />
  )
}

export default Spinner
