import { useState } from 'react'
import { ArrowRight, Check, FileText, Info, Sparkles } from 'lucide-react'
import { ItemPicker } from '../../../components/ItemPicker'
import type { PickedItem } from '../../../components/ItemPicker'
import { Notice } from '../../../components/Notice'
import { Button } from '../../../ui/Button'
import { Drawer } from '../../../ui/Drawer'
import { Textarea } from '../../../ui/Textarea'
import { cx } from '../../../ui/cx'
import {
  BOM_AI_REVIEW_NOTICE,
  BOM_AI_SOURCES,
  BOM_TEMPLATES,
  bomAiAvailability,
} from '../../../services/bomAiService'
import type { BomAiSourceType, BomTemplate } from '../../../services/bomAiService'

/**
 * "Create with AI" — choose how the first draft should be prepared.
 *
 * Two things this drawer will not do.
 *
 * It does not pretend. AI drafting is not switched on for this deployment, and
 * the drawer says so plainly instead of showing a spinner that never resolves
 * or, worse, a component list nobody produced. A fabricated bill of materials
 * is a production instruction: somebody would issue stock against it.
 *
 * It does not activate anything. Whatever a drafting service eventually
 * returns opens in the ordinary editor for review and is saved through the
 * ordinary endpoint, under the same validation and the same permissions as a
 * bill typed by hand.
 *
 * The two sources that need no AI at all — copying an existing bill, starting
 * from a template shape — stay usable, because hiding two working features
 * behind a missing third would be its own kind of dishonesty.
 */

export interface BomAiDialogProps {
  open: boolean
  onClose: () => void
  /** Start a blank bill for this finished item. */
  onStartFromItem: (item: PickedItem | null) => void
  /** Open the "copy an existing bill" flow (the compare / duplicate path). */
  onCopyExisting: () => void
  onUseTemplate: (template: BomTemplate) => void
  canWrite: boolean
}

export function BomAiDialog({
  open,
  onClose,
  onStartFromItem,
  onCopyExisting,
  onUseTemplate,
  canWrite,
}: BomAiDialogProps) {
  const availability = bomAiAvailability()
  const [source, setSource] = useState<BomAiSourceType>('item')
  const [item, setItem] = useState<PickedItem | null>(null)
  const [spec, setSpec] = useState('')

  const chosen = BOM_AI_SOURCES.find((s) => s.type === source)
  const blocked = Boolean(chosen?.needsAi) && !availability.available

  const primary = () => {
    if (source === 'existing_bom') {
      onCopyExisting()
      return
    }
    // Every AI-backed path still has a useful floor: open the editor with the
    // finished item already chosen, so the drawer is never a dead end.
    onStartFromItem(item)
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="lg"
      title="Create BOM with AI"
      description="Choose how Aicountly should prepare the first draft."
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {canWrite ? (
            <Button iconRight={ArrowRight} onClick={primary}>
              {source === 'existing_bom' ? 'Pick a bill to copy' : 'Open the editor'}
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="space-y-4">
        {!availability.available ? (
          <Notice kind="info" title="AI drafting is not available yet">
            {availability.reason}
          </Notice>
        ) : null}

        <fieldset className="space-y-2">
          <legend className="mb-1 text-[11px] font-bold uppercase tracking-wide text-gray-400">
            Starting point
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {BOM_AI_SOURCES.map((option) => {
              const selected = source === option.type
              const unavailable = option.needsAi && !availability.available
              return (
                <label
                  key={option.type}
                  className={cx(
                    'flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 transition-colors',
                    selected ? 'border-primary bg-primary-light/40' : 'border-gray-200 bg-white hover:border-primary/30',
                    unavailable && 'opacity-70',
                  )}
                >
                  <input
                    type="radio"
                    name="bom-ai-source"
                    value={option.type}
                    checked={selected}
                    onChange={() => setSource(option.type)}
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[rgb(var(--color-primary))]"
                  />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span className="text-[12px] font-semibold text-gray-900">{option.title}</span>
                      {option.needsAi ? (
                        <Sparkles
                          className={cx('h-3 w-3 shrink-0', unavailable ? 'text-gray-300' : 'text-primary')}
                          aria-hidden
                        />
                      ) : (
                        <Check className="h-3 w-3 shrink-0 text-emerald-600" aria-hidden />
                      )}
                    </span>
                    <span className="mt-0.5 block text-[10.5px] leading-relaxed text-gray-500">
                      {option.description}
                      {unavailable ? ' Needs AI drafting, which is not switched on yet.' : ''}
                    </span>
                  </span>
                </label>
              )
            })}
          </div>
        </fieldset>

        {source === 'template' ? (
          <section className="space-y-2">
            <h3 className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Structures</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {BOM_TEMPLATES.map((template) => (
                <button
                  key={template.key}
                  type="button"
                  onClick={() => onUseTemplate(template)}
                  disabled={!canWrite}
                  className="rounded-xl border border-gray-200 bg-white p-3 text-left transition-colors hover:border-primary/40 hover:bg-primary-light/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="block text-[12px] font-semibold text-gray-900">{template.title}</span>
                  <span className="mt-0.5 block text-[10.5px] leading-relaxed text-gray-500">
                    {template.description}
                  </span>
                  <span className="mt-1 block text-[10px] text-gray-400">
                    Opens {template.componentRows} component row
                    {template.componentRows === 1 ? '' : 's'}
                    {template.scrapRows > 0 ? ' and a scrap row' : ''}.
                  </span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {source !== 'template' && source !== 'existing_bom' ? (
          <section className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-gray-700" htmlFor="bom-ai-item">
                Finished item
              </label>
              <ItemPicker id="bom-ai-item" value={item} onChange={setItem} placeholder="Search the item this bill produces…" />
              <p className="text-[10.5px] text-gray-400">
                Optional. Choosing it now means the editor opens with the item already set.
              </p>
            </div>

            {source === 'text' ? (
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-gray-700" htmlFor="bom-ai-spec">
                  Specification
                </label>
                <Textarea
                  id="bom-ai-spec"
                  rows={5}
                  value={spec}
                  onChange={(e) => setSpec(e.target.value)}
                  placeholder={'1 wooden seat\n4 metal legs\n16 screws'}
                  disabled={blocked}
                />
              </div>
            ) : null}

            {source === 'document' ? (
              <div className="flex items-start gap-2.5 rounded-xl border border-dashed border-gray-300 bg-gray-50/60 p-4">
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden />
                <p className="text-[11px] leading-relaxed text-gray-500">
                  Uploading a drawing or specification will be available with AI drafting. Nothing is
                  uploaded today, so no file picker is offered here.
                </p>
              </div>
            ) : null}
          </section>
        ) : null}

        <p className="flex items-start gap-1.5 rounded-lg bg-gray-50 px-3 py-2.5 text-[10.5px] leading-relaxed text-gray-600">
          <Info className="mt-px h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />
          <span>{BOM_AI_REVIEW_NOTICE}</span>
        </p>
      </div>
    </Drawer>
  )
}

export default BomAiDialog
