import { useId, useState } from 'react'
import {
  ChevronRight,
  Eye,
  FileText,
  Lightbulb,
  Play,
  Search,
  Sparkles,
  X,
} from 'lucide-react'
import { Button } from '../../../ui/Button'
import { Card } from '../../../ui/Card'
import { Input } from '../../../ui/Input'
import { MenuButton } from '../../../ui/MenuButton'
import { Select } from '../../../ui/Select'
import { Tooltip } from '../../../ui/Tooltip'
import { Notice } from '../../../components/Notice'
import type { ItemFormOptions } from '../../../services/items'
import type { BulkFieldSpec, ValueCheck } from './bulkEditFields'
import { BULK_EDIT_FIELDS, fieldChoices, isReadOnlyField } from './bulkEditFields'
import type { ApplyGate, ChangeChip, ChipKey } from './bulkEditModel'
import type { BulkEditTemplate } from './bulkEditTemplates'

/**
 * Step one: narrow the catalogue, then say what to change.
 *
 * The panel is the whole question in one card — filters on the first row, the
 * change on the second, what is currently set as chips under them, and the two
 * actions that can be taken. Nothing here writes anything; Apply opens a
 * confirmation, and Preview opens the list of what would change.
 */

export interface BulkEditConfigPanelProps {
  search: string
  onSearch: (value: string) => void
  groupId: string
  onGroup: (value: string) => void
  status: string
  onStatus: (value: string) => void

  field: BulkFieldSpec
  onField: (key: string) => void
  newValue: string
  onNewValue: (value: string) => void
  options: ItemFormOptions | null
  optionsLoading: boolean
  check: ValueCheck
  /** The tidied-up form of what was typed, when it differs. */
  suggestion: string | null
  onApplySuggestion: () => void

  chips: readonly ChangeChip[]
  onClearChip: (key: ChipKey) => void

  gate: ApplyGate
  /**
   * What the reader TICKED — the number the button names.
   *
   * Not the number of rows that would change: the button answers "apply this to
   * my selection", and a label that quietly shrank because three of the ticked
   * items already hold the value would read as the screen losing the selection.
   * The split is stated where it belongs — in the rail, the preview and the
   * confirmation, all of which name both figures before anything is written.
   */
  selectedCount: number
  applying: boolean
  onApply: () => void
  onPreview: () => void

  templates: readonly BulkEditTemplate[]
  templatesAvailable: boolean
  onApplyTemplate: (template: BulkEditTemplate) => void
  onOpenTemplateDialog: () => void
}

const TIPS: readonly string[] = [
  'Filter the catalogue first, then tick the items — the Apply button always names the number it will write.',
  'Preview the change before a large update. It lists every row’s value before and after.',
  'Items that already hold the value are counted separately and are not written again.',
  'Save a bulk change you repeat as a template; it keeps the field and the filters, never the item list.',
  'Suggestions on this screen only tidy up what you typed. They never propose a value for an item, and never a tax classification.',
]

function QuickTips({ onClose }: { onClose: () => void }) {
  return (
    <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 p-3" role="region" aria-label="Quick tips">
      <div className="flex items-start justify-between gap-3">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-sky-800">
          <Lightbulb className="h-3.5 w-3.5" aria-hidden />
          Quick tips
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Hide quick tips"
          className="rounded p-0.5 text-sky-700 hover:bg-sky-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-sky-900">
        {TIPS.map((tip) => (
          <li key={tip} className="flex gap-2">
            <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-sky-500" />
            <span>{tip}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The editor for the selected field — a picker, a number, a code or a status. */
function NewValueEditor({
  field,
  value,
  onChange,
  options,
  optionsLoading,
  invalid,
  describedBy,
  inputId,
}: {
  field: BulkFieldSpec
  value: string
  onChange: (value: string) => void
  options: ItemFormOptions | null
  optionsLoading: boolean
  invalid: boolean
  describedBy: string
  inputId: string
}) {
  if (isReadOnlyField(field)) {
    return (
      <Input
        id={inputId}
        size="md"
        value=""
        readOnly
        disabled
        aria-describedby={describedBy}
        placeholder={`${field.label} is maintained in Smart Books`}
      />
    )
  }

  if (field.kind === 'select' || field.kind === 'status') {
    const choices = fieldChoices(field, options)
    return (
      <Select
        id={inputId}
        size="md"
        value={value}
        invalid={invalid}
        aria-describedby={describedBy}
        disabled={field.kind === 'select' && optionsLoading}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">
          {field.kind === 'status'
            ? 'Choose…'
            : optionsLoading
              ? 'Loading…'
              : field.clearable
                ? 'None — clear the field'
                : 'Choose…'}
        </option>
        {choices.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </Select>
    )
  }

  return (
    <div className="relative">
      <Input
        id={inputId}
        size="md"
        type={field.kind === 'money' || field.kind === 'quantity' ? 'number' : 'text'}
        inputMode={field.kind === 'money' || field.kind === 'quantity' ? 'decimal' : undefined}
        min={field.kind === 'money' || field.kind === 'quantity' ? 0 : undefined}
        value={value}
        invalid={invalid}
        aria-describedby={describedBy}
        placeholder={field.placeholder ?? 'New value'}
        onChange={(e) => onChange(e.target.value)}
        className={value ? 'pr-9' : undefined}
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear new value"
          className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : null}
    </div>
  )
}

/**
 * The one-press cleanup beside the value.
 *
 * It offers the tidied value and nothing else. There is no AI endpoint in
 * Inventory (see services/inventoryAiService.ts), so the alternative to a
 * deterministic string tidy would be a fabricated "suggestion" — and for a code
 * that carries legal weight, that is the one thing this screen must never do.
 * When there is nothing to tidy it says so rather than pretending to think.
 */
function SuggestionCard({
  field,
  suggestion,
  onApply,
  disabled,
}: {
  field: BulkFieldSpec
  suggestion: string | null
  onApply: () => void
  disabled: boolean
}) {
  if (disabled) {
    return (
      <div className="flex min-h-[2.25rem] items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-500">
        <Sparkles className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
        <span>Not available for this field</span>
      </div>
    )
  }

  if (!suggestion) {
    return (
      <div className="flex min-h-[2.25rem] items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs text-gray-500">
        <Sparkles className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
        <span className="truncate">Nothing to tidy up</span>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={onApply}
      className="group flex min-h-[2.25rem] w-full items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-left transition-colors hover:bg-emerald-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
    >
      <Sparkles className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-semibold text-emerald-800">Tidy up the value</span>
        <span className="block truncate text-[10px] text-gray-600">
          Use <span className="font-semibold tabular-nums">{suggestion}</span> for {field.label}
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-emerald-600 transition-transform group-hover:translate-x-0.5" aria-hidden />
    </button>
  )
}

export function BulkEditConfigPanel({
  search,
  onSearch,
  groupId,
  onGroup,
  status,
  onStatus,
  field,
  onField,
  newValue,
  onNewValue,
  options,
  optionsLoading,
  check,
  suggestion,
  onApplySuggestion,
  chips,
  onClearChip,
  gate,
  selectedCount,
  applying,
  onApply,
  onPreview,
  templates,
  templatesAvailable,
  onApplyTemplate,
  onOpenTemplateDialog,
}: BulkEditConfigPanelProps) {
  const [tipsOpen, setTipsOpen] = useState(false)
  const ids = useId()
  const searchId = `${ids}-search`
  const groupId_ = `${ids}-group`
  const statusId = `${ids}-status`
  const fieldId = `${ids}-field`
  const valueId = `${ids}-value`
  const helpId = `${ids}-help`
  const gateId = `${ids}-gate`

  const readOnly = isReadOnlyField(field)
  const labelCls = 'text-[11px] font-semibold uppercase tracking-wide text-gray-500'

  const templateActions = [
    ...templates.map((t) => ({
      key: t.id,
      label: t.name,
      icon: FileText,
      onSelect: () => onApplyTemplate(t),
    })),
    {
      key: 'manage',
      label: templates.length > 0 ? 'Save or manage templates…' : 'Save this configuration…',
      icon: FileText,
      separated: templates.length > 0,
      onSelect: onOpenTemplateDialog,
    },
  ]

  return (
    <Card padding="md" className="min-w-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-gray-900">1. Choose items and field to update</h2>
        <div className="flex items-center gap-1">
          <Button
            variant="link"
            size="xs"
            icon={Lightbulb}
            aria-expanded={tipsOpen}
            onClick={() => setTipsOpen((v) => !v)}
          >
            Quick tips
          </Button>
          {templatesAvailable ? (
            <MenuButton
              variant="link"
              size="xs"
              label="Bulk edit templates"
              icon={FileText}
              actions={templateActions}
              align="end"
              width={248}
            >
              Bulk edit templates
            </MenuButton>
          ) : null}
        </div>
      </div>

      {/* Row 1 — which items */}
      <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.8fr)]">
        <div className="min-w-0">
          <label className={labelCls} htmlFor={searchId}>
            Search items
          </label>
          <div className="mt-1">
            <Input
              id={searchId}
              size="md"
              type="search"
              value={search}
              leadingIcon={Search}
              placeholder="Search name, alias, SKU or barcode…"
              onChange={(e) => onSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="min-w-0">
          <label className={labelCls} htmlFor={groupId_}>
            Item group
          </label>
          <div className="mt-1">
            <Select id={groupId_} size="md" value={groupId} onChange={(e) => onGroup(e.target.value)}>
              <option value="">All groups</option>
              {(options?.item_groups ?? []).map((g) => (
                <option key={g.item_grp_id} value={g.item_grp_id}>
                  {g.grp_name}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="min-w-0">
          <label className={labelCls} htmlFor={statusId}>
            Status
          </label>
          <div className="mt-1">
            <Select id={statusId} size="md" value={status} onChange={(e) => onStatus(e.target.value)}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="all">All</option>
            </Select>
          </div>
        </div>
      </div>

      {/* Row 2 — what changes */}
      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,0.85fr)] md:items-end">
        <div className="min-w-0">
          <label className={labelCls} htmlFor={fieldId}>
            Field to update
          </label>
          <div className="mt-1">
            <Select id={fieldId} size="md" value={field.key} onChange={(e) => onField(e.target.value)}>
              {BULK_EDIT_FIELDS.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                  {f.owner === 'books' ? ' — read only' : ''}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="min-w-0">
          <label className={labelCls} htmlFor={valueId}>
            New value
          </label>
          <div className="mt-1">
            <NewValueEditor
              field={field}
              value={newValue}
              onChange={onNewValue}
              options={options}
              optionsLoading={optionsLoading}
              invalid={check.level === 'error' && !readOnly}
              describedBy={helpId}
              inputId={valueId}
            />
          </div>
        </div>
        <div className="min-w-0 md:pb-0.5">
          <SuggestionCard field={field} suggestion={suggestion} onApply={onApplySuggestion} disabled={readOnly} />
        </div>
      </div>

      {/* The one line that says what the value is doing. Always rendered so the
          row below it does not jump as the reader types. */}
      <p
        id={helpId}
        className={[
          'mt-2 text-xs',
          readOnly ? 'text-amber-700' : check.level === 'error' ? 'text-red-600' : check.level === 'ok' ? 'text-emerald-700' : 'text-gray-500',
        ].join(' ')}
      >
        {readOnly ? field.ownerNote : check.message}
        {!readOnly && check.level === 'ok' && field.kind === 'code' ? (
          <span className="text-gray-500"> Inventory checks the shape only — it does not verify the classification.</span>
        ) : null}
      </p>

      {readOnly ? (
        <Notice kind="warning" title={`${field.label} is maintained in Smart Books`} className="mt-3">
          Inventory stores it so the item reads whole, and the API refuses a change made here. Pick another field to run
          a bulk edit — the column below still shows what every item currently holds.
        </Notice>
      ) : null}

      {tipsOpen ? <QuickTips onClose={() => setTipsOpen(false)} /> : null}

      {/* Chips — the whole of what is set, in one scannable row. */}
      {chips.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {chips.map((chip) =>
            chip.clearable ? (
              <button
                key={chip.key}
                type="button"
                onClick={() => onClearChip(chip.key)}
                className="inline-flex min-h-[1.75rem] items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2.5 text-[11px] text-sky-900 transition-colors hover:bg-sky-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                <span className="text-sky-700">{chip.label}:</span>
                <span className="max-w-[12rem] truncate font-semibold">{chip.value}</span>
                <X className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
                <span className="sr-only">Clear</span>
              </button>
            ) : (
              <span
                key={chip.key}
                className="inline-flex min-h-[1.75rem] items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-2.5 text-[11px] text-gray-700"
              >
                <span className="text-gray-500">{chip.label}:</span>
                <span className="max-w-[12rem] truncate font-semibold">{chip.value}</span>
              </span>
            ),
          )}
        </div>
      ) : null}

      {/* Actions */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Tooltip label={gate.reason ?? ''}>
          <span>
            <Button
              size="lg"
              icon={Play}
              onClick={onApply}
              loading={applying}
              disabled={!gate.canApply}
              aria-describedby={gate.reason ? gateId : undefined}
            >
              {applying ? 'Applying…' : `Apply changes to ${selectedCount} item${selectedCount === 1 ? '' : 's'}`}
            </Button>
          </span>
        </Tooltip>
        <Button size="lg" variant="secondary" icon={Eye} onClick={onPreview} disabled={applying}>
          Preview changes
        </Button>
        {gate.reason ? (
          <p id={gateId} className="text-xs text-gray-500">
            {gate.reason}
          </p>
        ) : null}
      </div>
    </Card>
  )
}
