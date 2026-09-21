import { ArrowLeft, ArrowRight, Check, Save } from 'lucide-react'
import { Button } from '../../ui/Button'
import { StickyActionBar } from '../../ui/shell/StickyActionBar'
import type { ItemSection } from './itemSections'

export interface ItemWizardBarProps {
  sections: readonly ItemSection[]
  /** The section on screen. */
  active: ItemSection['id']
  onSelect: (id: ItemSection['id']) => void
  onSave: () => void
  saving: boolean
  canSave: boolean
  readOnly: boolean
  dirty: boolean
  isNew: boolean
}

/**
 * The phone's way through the workspace: one section at a time, Back and Continue.
 *
 * Why a wizard only here. On a wide screen the eight sections are one page and the nav is an
 * anchor — that is the right shape when the whole form is visible at once and a reader wants to
 * jump. On a 390px screen the same page is roughly nine screens of scrolling with no sense of
 * where the end is, and the fields at the bottom (opening stock, accounting) are reached by
 * accident or not at all. So the phone gets progression and a finish line instead.
 *
 * The buttons are 44px tall — this design system's 2rem controls are fine under a mouse and too
 * small under a thumb, and this bar is the one place on the page where every tap matters.
 */
export function ItemWizardBar({
  sections,
  active,
  onSelect,
  onSave,
  saving,
  canSave,
  readOnly,
  dirty,
  isNew,
}: ItemWizardBarProps) {
  const index = sections.findIndex((s) => s.id === active)
  const current = index < 0 ? 0 : index
  const isLast = current === sections.length - 1
  const tap = 'min-h-11'

  return (
    <StickyActionBar
      status={
        <span className="text-xs text-gray-500">
          Step {current + 1} of {sections.length}
          <span className="hidden sm:inline"> · {sections[current]?.label}</span>
          {dirty ? ' · unsaved' : ''}
        </span>
      }
    >
      <Button
        variant="secondary"
        icon={ArrowLeft}
        className={tap}
        disabled={current === 0 || saving}
        onClick={() => onSelect(sections[current - 1].id)}
      >
        Back
      </Button>

      {isLast ? (
        readOnly ? null : (
          <Button variant="primary" icon={saving ? undefined : isNew ? Check : Save} className={tap} loading={saving} disabled={!canSave} onClick={onSave}>
            {saving ? (isNew ? 'Creating…' : 'Saving…') : isNew ? 'Create item' : 'Save item'}
          </Button>
        )
      ) : (
        <Button variant="primary" iconRight={ArrowRight} className={tap} disabled={saving} onClick={() => onSelect(sections[current + 1].id)}>
          Continue
        </Button>
      )}
    </StickyActionBar>
  )
}

export default ItemWizardBar
