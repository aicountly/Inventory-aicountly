import { Loader2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'
import { AIC, cx } from './cx'

const VARIANTS = {
  primary:
    'bg-primary text-white hover:bg-primary-hover focus:ring-2 focus:ring-primary/30 disabled:bg-primary/60 shadow-card',
  secondary:
    'bg-white text-gray-700 border border-gray-200 hover:border-primary/40 hover:bg-primary-light hover:text-primary focus:ring-2 focus:ring-primary/30',
  ghost:
    'bg-transparent text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus:ring-2 focus:ring-gray-200',
  danger:
    'bg-red-600 text-white hover:bg-red-700 focus:ring-2 focus:ring-red-300 disabled:bg-red-300',
  outline:
    'bg-white text-primary border border-primary/40 hover:bg-primary-light focus:ring-2 focus:ring-primary/30',
  link: 'bg-transparent text-primary hover:underline px-1 py-1 focus:ring-0',
  warning:
    'bg-amber-500 text-white hover:bg-amber-600 focus:ring-2 focus:ring-amber-300',
} as const

const SIZES = {
  xs: 'h-7 px-2 text-xs gap-1 rounded-md',
  sm: 'h-8 px-3 text-sm gap-1.5 rounded-lg',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-lg',
  lg: 'h-10 px-4 text-sm gap-2 rounded-lg',
} as const

export type ButtonVariant = keyof typeof VARIANTS
export type ButtonSize = keyof typeof SIZES

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /**
   * Declared, not inherited: React 19 passes `ref` to a function component as
   * an ordinary prop, but `ButtonHTMLAttributes` does not name it, so without
   * this a caller that needs the element (to anchor a menu to it, to focus it)
   * cannot ask for it. It rides along in `...rest` onto the real `<button>`.
   */
  ref?: Ref<HTMLButtonElement>
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: LucideIcon
  iconRight?: LucideIcon
  /** Swaps the leading icon for a spinner and disables the button. */
  loading?: boolean
  /** Shortcut hint rendered as a `kbd` chip inside the button. */
  kbd?: string
  block?: boolean
  children?: ReactNode
}

export function Button({
  variant = 'primary',
  size = 'sm',
  icon: Icon,
  iconRight: IconRight,
  loading = false,
  disabled = false,
  type = 'button',
  className,
  children,
  kbd,
  block = false,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        AIC,
        'inline-flex items-center justify-center font-medium transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-70',
        VARIANTS[variant],
        SIZES[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden />
      ) : Icon ? (
        <Icon className={cx('shrink-0', size === 'xs' ? 'w-3.5 h-3.5' : 'w-4 h-4')} aria-hidden />
      ) : null}
      {children ? <span className="truncate">{children}</span> : null}
      {kbd ? <span className="kbd ml-1">{kbd}</span> : null}
      {IconRight ? <IconRight className="w-4 h-4 opacity-80 shrink-0" aria-hidden /> : null}
    </button>
  )
}

export default Button
