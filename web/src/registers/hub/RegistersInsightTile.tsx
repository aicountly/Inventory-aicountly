import { Quote } from 'lucide-react'
import { AIC, cx } from '../../ui/cx'

/**
 * The panel beside a section whose single card would otherwise leave two-thirds
 * of a row empty.
 *
 * It is filler with something to say, and it knows it: no link, no number, no
 * claim about this company's data. It is dropped entirely below `lg`, where
 * vertical space is the scarce thing and a phone has better uses for 90px than
 * a motto.
 */
export function RegistersInsightTile({ className }: { className?: string }) {
  return (
    <aside
      className={cx(
        AIC,
        'register-insight-wash hidden min-h-[5.5rem] items-center gap-3 rounded-xl border border-primary/15 px-5 py-4 lg:flex',
        className,
      )}
    >
      <Quote className="h-5 w-5 shrink-0 self-start text-primary/60" aria-hidden />
      <p className="text-sm leading-relaxed text-gray-600">
        Accurate registers.
        <strong className="block font-semibold text-gray-900">Confident decisions.</strong>
      </p>
    </aside>
  )
}

export default RegistersInsightTile
