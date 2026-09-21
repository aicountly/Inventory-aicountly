import { useCallback } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { sectionDomId } from './itemSections'
import type { ItemFormState } from './itemForm'
import type { InsightSection } from '../../services/inventoryAiService'
import { AIC, cx } from '../../ui/cx'

/** What every section card needs to read and write the draft. */
export interface ItemCardBaseProps {
  form: ItemFormState
  set: <K extends keyof ItemFormState>(key: K, value: ItemFormState[K]) => void
  /** Field-level message: a client validation error, or the field the server blamed. */
  err: (key: string) => string | undefined
  readOnly: boolean
  registerSection: (id: string, el: HTMLElement | null) => void
}

export interface ItemSectionCardProps {
  id: InsightSection
  title: string
  description?: ReactNode
  icon?: LucideIcon
  action?: ReactNode
  register: (id: string, el: HTMLElement | null) => void
  children: ReactNode
  className?: string
}

/**
 * One anchored section of the workspace.
 *
 * `scroll-mt-*` is what makes "jump to this section" land under the sticky nav instead of behind
 * it; it has to be on the scroll target itself, which is why it lives here rather than on the nav.
 * The heading is a real `h2` and the card is a `section` labelled by it, so the whole page is
 * navigable by heading in a screen reader — the same eight stops the sticky bar offers a mouse.
 */
export function ItemSectionCard({
  id,
  title,
  description,
  icon: Icon,
  action,
  register,
  children,
  className,
}: ItemSectionCardProps) {
  const domId = sectionDomId(id)
  const ref = useCallback((el: HTMLElement | null) => register(domId, el), [register, domId])
  return (
    <section
      id={domId}
      ref={ref}
      aria-labelledby={`${domId}-title`}
      className={cx(AIC, 'scroll-mt-24 rounded-2xl border border-gray-200 bg-white p-4 shadow-card md:p-5', className)}
    >
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 pb-3">
        <div className="flex min-w-0 items-start gap-3">
          {Icon ? (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-light">
              <Icon className="h-4 w-4 text-primary" aria-hidden />
            </span>
          ) : null}
          <div className="min-w-0">
            <h2 id={`${domId}-title`} className="text-[15px] font-bold tracking-tight text-gray-900">
              {title}
            </h2>
            {description ? <p className="mt-0.5 text-xs leading-relaxed text-gray-500">{description}</p> : null}
          </div>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      {children}
    </section>
  )
}

export default ItemSectionCard
