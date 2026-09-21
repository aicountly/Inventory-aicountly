import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Info, Sparkles } from 'lucide-react'
import type { ItemSuggestion } from '../../services/inventoryAiService'
import { HSN_SUGGESTION_NOTE } from '../../services/inventoryAiService'
import { Button } from '../../ui/Button'
import { Drawer } from '../../ui/Drawer'
import { EmptyState } from '../../ui/EmptyState'
import { AIC, cx } from '../../ui/cx'

/**
 * Suggestions, shown before they are taken.
 *
 * The rule the whole drawer exists to enforce: **nothing is written until somebody ticks it and
 * presses Apply.** Every row shows what the field holds now, what would replace it and why, and
 * every row starts unticked. A "Suggest" button that quietly rewrote nine fields would be the most
 * destructive control on the page, and the user would find out about it at the next save.
 *
 * Applying does not save. The fields are filled in, the form goes dirty, the drawer closes, and the
 * user reviews and saves in their own time — so a suggestion is always reversible by walking away.
 *
 * On HSN/SAC there is a note instead of a row. Guessing a tax classification from a product name is
 * not assistance, it is Inventory answering Books' question with a plausible-sounding number.
 */
export interface ItemAiSuggestDrawerProps {
  open: boolean
  onClose: () => void
  suggestions: ItemSuggestion[]
  loading: boolean
  onApply: (chosen: ItemSuggestion[]) => void
}

export function ItemAiSuggestDrawer({ open, onClose, suggestions, loading, onApply }: ItemAiSuggestDrawerProps) {
  const [checked, setChecked] = useState<Record<string, boolean>>({})

  /*
   * Every visit starts with nothing selected — a tick left over from last time is a silent write.
   *
   * Keyed on `open` ALONE, deliberately. Keying it on `suggestions` as well looks equivalent and is
   * not: the list is fetched after the drawer opens, so its arrival would fire this a second time
   * and wipe anything ticked in between. A checkbox that silently unticks itself is exactly the
   * kind of thing that makes somebody press Apply on a selection they did not make.
   *
   * A tick for a suggestion that is no longer in the list cannot leak through either way, because
   * `chosen` is derived by filtering the current list rather than by reading the ticks.
   */
  useEffect(() => {
    if (open) setChecked({})
  }, [open])

  const chosen = useMemo(() => suggestions.filter((s) => checked[s.id]), [suggestions, checked])
  const allOn = suggestions.length > 0 && chosen.length === suggestions.length

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="lg"
      title={
        <span className="inline-flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-violet-600" aria-hidden />
          Suggestions for this item
        </span>
      }
      description="Review each one. Nothing is changed until you apply it, and applying does not save."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Dismiss
          </Button>
          <Button
            icon={ArrowRight}
            disabled={chosen.length === 0}
            onClick={() => {
              onApply(chosen)
              onClose()
            }}
          >
            {chosen.length === 0
              ? 'Apply selected'
              : `Apply ${chosen.length} ${chosen.length === 1 ? 'suggestion' : 'suggestions'}`}
          </Button>
        </>
      }
    >
      {loading ? (
        <p className="text-sm text-gray-500">Looking at this item…</p>
      ) : suggestions.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="Nothing to suggest"
          description="Every field this can help with already holds a value. Suggestions never overwrite what you have typed."
        />
      ) : (
        <div className={cx(AIC, 'space-y-3')}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-gray-500">
              {suggestions.length} {suggestions.length === 1 ? 'suggestion' : 'suggestions'}, all for fields that are
              currently empty.
            </p>
            <Button
              variant="ghost"
              size="xs"
              onClick={() =>
                setChecked(allOn ? {} : Object.fromEntries(suggestions.map((s) => [s.id, true])))
              }
            >
              {allOn ? 'Clear all' : 'Select all'}
            </Button>
          </div>

          <ul className="space-y-2">
            {suggestions.map((s) => {
              const id = `suggestion-${s.id}`
              const on = Boolean(checked[s.id])
              return (
                <li key={s.id}>
                  <label
                    htmlFor={id}
                    className={cx(
                      'flex cursor-pointer gap-3 rounded-xl border p-3 transition-colors',
                      on ? 'border-violet-300 bg-violet-50' : 'border-gray-200 bg-white hover:border-gray-300',
                    )}
                  >
                    <input
                      id={id}
                      type="checkbox"
                      checked={on}
                      onChange={(e) => setChecked((c) => ({ ...c, [s.id]: e.target.checked }))}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-violet-600"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-gray-900">{s.label}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
                        <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-gray-500 line-through decoration-gray-400">
                          {s.current || 'empty'}
                        </span>
                        <ArrowRight className="h-3 w-3 shrink-0 text-gray-400" aria-hidden />
                        <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-700">
                          {s.suggested}
                        </span>
                      </div>
                      <p className="mt-1.5 text-[11px] leading-relaxed text-gray-500">{s.reason}</p>
                    </div>
                  </label>
                </li>
              )
            })}
          </ul>

          <p className="flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] leading-relaxed text-sky-800">
            <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{HSN_SUGGESTION_NOTE}</span>
          </p>
        </div>
      )}
    </Drawer>
  )
}

export default ItemAiSuggestDrawer
