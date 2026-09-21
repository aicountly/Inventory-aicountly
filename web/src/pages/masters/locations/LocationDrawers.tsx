import { AlertTriangle, CircleCheck, Info, Lightbulb, Warehouse } from 'lucide-react'
import { BarList } from '../../../dashboard/charts/BarList'
import type { SeriesItem } from '../../../dashboard/model'
import { MasterForm } from '../../../masters/MasterForm'
import { locationsConfig } from '../../../masters/configs'
import type { FormValues } from '../../../masters/types'
import { Button } from '../../../ui/Button'
import { Drawer } from '../../../ui/Drawer'
import { EmptyState } from '../../../ui/EmptyState'
import { cx } from '../../../ui/cx'
import type { ItemFormOptions } from '../../../services/items'
import type { Location } from '../../../services/masters'
import { formatInt } from '../../../utils/format'
import type { LocationInsight } from './locationsModel'

/**
 * The three panels this screen opens over its list.
 *
 * The form is a Drawer rather than the Modal `MasterPage` uses, for the reason
 * the Drawer was written: a bin is created *against* the layout already on
 * screen — "is there already a Rack 3 in this zone?" — and a modal answers that
 * question by hiding the list.
 *
 * The fields themselves are still `locationsConfig.fields`. The panel changed;
 * the contract with the API did not, so warehouse scoping, the parent-location
 * loader that excludes the row itself, and the validation rules are the ones
 * every other master already uses.
 */

/* ------------------------------------------------------------------- form -- */

export interface LocationFormDrawerProps {
  open: boolean
  mode: 'create' | 'edit'
  row: Location | null
  /** Prefilled values — a duplicate arrives with the source row's fields. */
  initialValues?: FormValues
  options: ItemFormOptions | null
  rows: readonly Location[]
  saving: boolean
  saveError: unknown
  readOnly: boolean
  onSubmit: (values: FormValues) => void
  onClose: () => void
}

const FORM_ID = 'location-form'

export function LocationFormDrawer({
  open,
  mode,
  row,
  initialValues,
  options,
  rows,
  saving,
  saveError,
  readOnly,
  onSubmit,
  onClose,
}: LocationFormDrawerProps) {
  const title = mode === 'create' ? 'New location' : readOnly ? 'Location' : 'Edit location'

  return (
    <Drawer
      open={open}
      title={title}
      description={
        mode === 'create'
          ? 'A zone, rack, shelf or bin inside one warehouse.'
          : row?.location_code
      }
      onClose={onClose}
      width="md"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {readOnly ? 'Close' : 'Cancel'}
          </Button>
          {readOnly ? null : (
            <Button type="submit" form={FORM_ID} loading={saving}>
              {mode === 'create' ? 'Create location' : 'Save changes'}
            </Button>
          )}
        </div>
      }
    >
      {open ? (
        <MasterForm<Location>
          key={`${mode}-${row?.location_id ?? 'new'}`}
          formId={FORM_ID}
          fields={locationsConfig.fields}
          mode={mode}
          row={row}
          options={options}
          rows={rows as Location[]}
          initialValues={initialValues ?? locationsConfig.toValues?.(row, options)}
          readOnly={readOnly}
          serverError={saveError}
          onSubmit={onSubmit}
        />
      ) : null}
    </Drawer>
  )
}

/* --------------------------------------------------------------- insights -- */

const INSIGHT_ICON = {
  info: Info,
  warning: AlertTriangle,
  success: CircleCheck,
} as const

const INSIGHT_STYLE = {
  info: { wrap: 'border-sky-100 bg-sky-50/60', tile: 'bg-white text-sky-600' },
  warning: { wrap: 'border-amber-200 bg-amber-50/60', tile: 'bg-white text-amber-600' },
  success: { wrap: 'border-primary/20 bg-primary-light/40', tile: 'bg-white text-primary' },
} as const

export interface LocationInsightsDrawerProps {
  open: boolean
  insights: readonly LocationInsight[]
  onClose: () => void
  /** Applies the insight's filter to the list and closes the panel. */
  onApplyFilter: (filter: Record<string, string>) => void
}

export function LocationInsightsDrawer({
  open,
  insights,
  onClose,
  onApplyFilter,
}: LocationInsightsDrawerProps) {
  return (
    <Drawer
      open={open}
      title="Smart insights"
      description="Checks run over your location setup"
      onClose={onClose}
      width="md"
      footer={
        <div className="flex items-center justify-end">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      {/*
        Named "checks", not "AI". Every line below is a count this build
        computed from the rows it loaded — locationInsights() in
        locationsModel.ts — and saying otherwise would be a claim about how the
        number was produced. The wording is the honest one until a real service
        backs it.
      */}
      {insights.length === 0 ? (
        <EmptyState
          icon={Lightbulb}
          title="Nothing to review yet"
          description="Create some locations and this panel will point out gaps worth tidying."
        />
      ) : (
        <ul className="space-y-2.5">
          {insights.map((insight) => {
            const Icon = INSIGHT_ICON[insight.tone]
            const style = INSIGHT_STYLE[insight.tone]
            return (
              <li key={insight.id} className={cx('rounded-xl border p-3', style.wrap)}>
                <div className="flex items-start gap-2.5">
                  <span className={cx('grid h-7 w-7 shrink-0 place-items-center rounded-lg', style.tile)} aria-hidden>
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold leading-snug text-gray-900">{insight.title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-gray-600">{insight.detail}</p>
                    {insight.filter ? (
                      <button
                        type="button"
                        onClick={() => onApplyFilter(insight.filter as Record<string, string>)}
                        className="mt-2 rounded-md text-[11px] font-semibold text-primary transition-colors hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                      >
                        Show these locations
                      </button>
                    ) : null}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <p className="mt-4 border-t border-gray-100 pt-3 text-[11px] leading-relaxed text-gray-400">
        These are rule-based checks over the locations loaded for this company, not model-generated
        advice.
      </p>
    </Drawer>
  )
}

/* --------------------------------------------------------------- coverage -- */

export interface LocationCoverageDrawerProps {
  open: boolean
  coverage: readonly SeriesItem[]
  total: number
  onClose: () => void
}

export function LocationCoverageDrawer({
  open,
  coverage,
  total,
  onClose,
}: LocationCoverageDrawerProps) {
  return (
    <Drawer
      open={open}
      title="Warehouse coverage"
      description={`${formatInt(total)} ${total === 1 ? 'location' : 'locations'} across ${formatInt(coverage.length)} ${coverage.length === 1 ? 'warehouse' : 'warehouses'}`}
      onClose={onClose}
      width="md"
      footer={
        <div className="flex items-center justify-end">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      {coverage.length === 0 ? (
        <EmptyState
          icon={Warehouse}
          title="No locations mapped yet"
          description="Every location belongs to one warehouse. Once you create some, this panel shows how they are spread."
        />
      ) : (
        <BarList items={coverage} />
      )}
    </Drawer>
  )
}
