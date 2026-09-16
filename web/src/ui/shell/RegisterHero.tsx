import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { AIC, cx } from '../cx'

export interface RegisterHeroProps {
  icon?: LucideIcon
  title: ReactNode
  description?: ReactNode
  /** Right-hand slot — the live-data badge on a register. */
  aside?: ReactNode
  className?: string
}

/**
 * The register's page hero: tile, name, one line of what it answers.
 *
 * It replaces a 16px bold line that sat in the same row as the breadcrumbs and
 * the toolbar, where the name of the screen competed with six buttons. The
 * height is deliberately restrained — this shell pins its chrome and gives the
 * rest of the viewport to the table, so every pixel spent here is a row the
 * reader does not see.
 */
export function RegisterHero({ icon: Icon, title, description, aside, className }: RegisterHeroProps) {
  return (
    <div
      className={cx(
        AIC,
        'flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-3 print:hidden',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3.5">
        {Icon ? (
          <span
            className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-primary-light to-primary-light/40 text-primary ring-1 ring-primary/10 xl:h-14 xl:w-14"
            aria-hidden
          >
            <Icon className="h-6 w-6 xl:h-7 xl:w-7" strokeWidth={1.75} />
          </span>
        ) : null}
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold tracking-tight text-gray-900 xl:text-2xl">
            {title}
          </h1>
          {description ? (
            <p className="mt-0.5 truncate text-sm text-gray-500">{description}</p>
          ) : null}
        </div>
      </div>
      {aside ? <div className="flex items-center gap-2">{aside}</div> : null}
    </div>
  )
}

export default RegisterHero
