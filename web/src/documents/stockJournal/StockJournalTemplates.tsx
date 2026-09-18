import { useState } from 'react'
import { Save, Trash2 } from 'lucide-react'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { EmptyState } from '../../ui/EmptyState'
import { Input } from '../../ui/Input'
import { AIC, cx } from '../../ui/cx'
import { formatDate } from '../../utils/format'
import type { JournalTemplate } from './templates'
import { reasonLabel } from './model'

interface StockJournalTemplatesProps {
  templates: readonly JournalTemplate[]
  canSave: boolean
  onSave: (name: string) => void
  onApply: (template: JournalTemplate) => void
  onDelete: (id: string) => void
}

/**
 * Recurring adjustments, kept as a skeleton to start from.
 *
 * A template carries the reason, the warehouse and the items — never quantities,
 * batches or serials. Applying one fills the header and lays out the lines; the
 * numbers are still typed, because the numbers are the whole point of the entry.
 */
export function StockJournalTemplates({ templates, canSave, onSave, onApply, onDelete }: StockJournalTemplatesProps) {
  const [name, setName] = useState('')

  return (
    <Card padding="lg">
      <div className="mb-3 border-b border-gray-100 pb-3">
        <h3 className="text-sm font-semibold text-gray-900">Templates</h3>
        <p className="mt-0.5 text-xs text-gray-500">
          Save the shape of an adjustment you raise often. Templates are kept in this browser for the
          selected company — they hold no quantities and are not documents.
        </p>
      </div>

      <div className={cx(AIC, 'flex flex-wrap items-end gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3')}>
        <label className="flex min-w-[14rem] flex-1 flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Save the current lines as a template
          </span>
          <Input
            size="md"
            placeholder="e.g. Monthly breakage write-off"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <Button
          icon={Save}
          disabled={!canSave || !name.trim()}
          title={canSave ? undefined : 'Add at least one item line first.'}
          onClick={() => {
            onSave(name)
            setName('')
          }}
        >
          Save template
        </Button>
      </div>

      {templates.length === 0 ? (
        <EmptyState
          compact
          className="mt-2"
          title="No templates yet"
          description="Build a journal on the Create tab, then save it here to reuse its shape."
        />
      ) : (
        <ul className="mt-3 space-y-2">
          {templates.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-gray-900">{t.name}</p>
                <p className="mt-0.5 text-[11px] text-gray-500">
                  {t.lines.length} line{t.lines.length === 1 ? '' : 's'}
                  {t.reason_code ? ` · ${reasonLabel(t.reason_code)}` : ''} · saved {formatDate(new Date(t.createdAt).toISOString())}
                </p>
              </div>
              <Button size="xs" variant="secondary" onClick={() => onApply(t)}>
                Use template
              </Button>
              <Button
                size="xs"
                variant="ghost"
                icon={Trash2}
                aria-label={`Delete template ${t.name}`}
                onClick={() => onDelete(t.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
