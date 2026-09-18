import { useEffect, useState } from 'react'
import { ArrowRight, Sparkles } from 'lucide-react'
import { Badge } from '../../../ui/Badge'
import { Button } from '../../../ui/Button'
import { Drawer } from '../../../ui/Drawer'
import { EmptyState } from '../../../ui/EmptyState'
import { AIC, cx } from '../../../ui/cx'
import type { Suggestion, SuggestionField } from './itemIntelligence'

export interface AiAssistDrawerProps {
  open: boolean
  onClose: () => void
  suggestions: Suggestion[]
  onApply: (suggestions: Suggestion[]) => void
  disabled?: boolean
}

/**
 * The assistant's proposals, one row each, none of them applied.
 *
 * The rule the whole drawer exists to enforce: a suggestion NEVER overwrites a
 * value the user typed without being told to. A field that already holds
 * something shows `current → proposed` and starts unticked; only the blanks are
 * ticked for you, and even those need the Apply button.
 */
export function AiAssistDrawer({ open, onClose, suggestions, onApply, disabled = false }: AiAssistDrawerProps) {
  /**
   * `null` means "nobody has ticked anything yet", which is not the same as an
   * empty set — it is what lets the default below be computed from the current
   * suggestions without an effect that would undo the reader's ticks on every
   * keystroke behind the drawer.
   */
  const [ticked, setTicked] = useState<ReadonlySet<SuggestionField> | null>(null)

  useEffect(() => {
    if (!open) setTicked(null)
  }, [open])

  // Filling a blank is safe to pre-tick; replacing something the user typed is not.
  const selected = ticked ?? new Set(suggestions.filter((s) => s.current === null).map((s) => s.field))

  const toggle = (field: SuggestionField) => {
    const next = new Set(selected)
    if (next.has(field)) next.delete(field)
    else next.add(field)
    setTicked(next)
  }

  const chosen = suggestions.filter((s) => selected.has(s.field))

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Item assistant"
      badge={<Badge tone="beta">Beta</Badge>}
      description="Review each suggestion before applying it. Nothing is changed until you apply."
      width="md"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-gray-500">
            {chosen.length === 0 ? 'Nothing selected' : `${chosen.length} selected`}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <Button
              variant="primary"
              icon={Sparkles}
              disabled={disabled || chosen.length === 0}
              onClick={() => {
                onApply(chosen)
                onClose()
              }}
            >
              Apply selected
            </Button>
          </div>
        </div>
      }
    >
      {suggestions.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="Nothing to suggest yet"
          description="Type an item name and the assistant will propose a print name, an alias, a SKU and any group, category or brand of yours that the name mentions."
        />
      ) : (
        <>
          <p className="mb-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[11px] leading-relaxed text-gray-500">
            Every suggestion below comes from this draft and from your own masters and items. Inventory has no
            classification service, so nothing here is guessed from outside your company.
          </p>
          <ul className={cx(AIC, 'flex list-none flex-col gap-2 p-0')}>
            {suggestions.map((s) => {
              const isOn = selected.has(s.field)
              return (
                <li key={s.field}>
                  <label
                    className={cx(
                      AIC,
                      'flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors',
                      isOn ? 'border-primary/40 bg-primary-light/40' : 'border-gray-200 bg-white hover:border-primary/25',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={isOn}
                      onChange={() => toggle(s.field)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--color-primary))]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{s.label}</span>
                        {s.current !== null ? <Badge tone="warning">Replaces a value</Badge> : null}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5 text-sm font-semibold text-gray-900">
                        {s.currentDisplay ? (
                          <>
                            <span className="text-gray-500 line-through">{s.currentDisplay}</span>
                            <ArrowRight className="h-3.5 w-3.5 text-gray-400" aria-hidden />
                            <span className="sr-only">changes to</span>
                          </>
                        ) : null}
                        <span className="text-primary">{s.display}</span>
                      </span>
                      <span className="mt-1 block text-[11px] leading-relaxed text-gray-500">{s.source}</span>
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </Drawer>
  )
}

export default AiAssistDrawer
