import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Boxes, Lightbulb, Network, Sparkles } from 'lucide-react'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { Notice } from '../../components/Notice'
import { cx } from '../../ui/cx'
import type { Warehouse, WarehouseGroup } from '../../services/masters'
import { buildTree } from '../tree'
import type { TreeNode } from '../tree'
import { isActive, warehouseCount } from './model'
import type { FilterState, GroupStats, Insight } from './model'
import { AiUnavailableError, buildSuggestionRequest, warehouseGroupsAi } from './warehouseGroupsAi'
import type { AiSuggestion } from './warehouseGroupsAi'

/**
 * The contextual column: what the estate looks like, and what is worth looking
 * at.
 *
 * Two cards, and the split between them is the point. "Group structure" and
 * "Insights" are arithmetic over the rows on this screen — counted in model.ts,
 * reproducible, and correct whether or not any AI service exists. The Aicountly
 * AI block above them is the seam for generative help; while nothing is
 * connected it says so and does nothing else. Labelling a rule that counts
 * empty groups as "AI" would be a claim about how the answer was produced that
 * happens not to be true.
 */

const TONE_STYLES: Record<Insight['tone'], { dot: string; text: string }> = {
  info: { dot: 'bg-sky-400', text: 'text-sky-700' },
  warning: { dot: 'bg-amber-400', text: 'text-amber-700' },
  danger: { dot: 'bg-red-400', text: 'text-red-700' },
}

interface StructureRowProps {
  node: TreeNode<WarehouseGroup>
  depth: number
  onOpen: (row: WarehouseGroup) => void
}

function StructureRow({ node, depth, onOpen }: StructureRowProps) {
  const row = node.row
  const count = warehouseCount(row)
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(row)}
        className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        style={{ paddingLeft: `${depth * 0.875 + 0.375}rem` }}
      >
        <span
          className={cx(
            'grid h-5 w-5 shrink-0 place-items-center rounded',
            isActive(row) ? 'bg-primary-light text-primary' : 'bg-gray-100 text-gray-400',
          )}
          aria-hidden
        >
          <Boxes className="h-3 w-3" />
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-gray-700">{row.grp_name}</span>
        <span className="shrink-0 text-[11px] font-semibold tabular-nums text-gray-400">({count})</span>
      </button>
      {node.children.length > 0 ? (
        <ul className="list-none p-0">
          {node.children.map((child) => (
            <StructureRow key={child.id} node={child} depth={depth + 1} onOpen={onOpen} />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

export interface WarehouseGroupsSidePanelProps {
  rows: readonly WarehouseGroup[]
  warehouses: readonly Warehouse[] | null
  stats: GroupStats
  insights: readonly Insight[]
  loading: boolean
  onOpen: (row: WarehouseGroup) => void
  onApplyFilters: (patch: Partial<FilterState>) => void
  onViewAll: () => void
  warehousesRoute: string
  canReadWarehouses: boolean
}

export function WarehouseGroupsSidePanel({
  rows,
  warehouses,
  stats,
  insights,
  loading,
  onOpen,
  onApplyFilters,
  onViewAll,
  warehousesRoute,
  canReadWarehouses,
}: WarehouseGroupsSidePanelProps) {
  const forest = useMemo(
    () => buildTree(rows, { idKey: 'warehouse_group_id', parentKey: 'parent_grp_id', labelOf: (r) => r.grp_name }),
    [rows],
  )

  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiAnswer, setAiAnswer] = useState<AiSuggestion | null>(null)

  const generate = async () => {
    setAiBusy(true)
    setAiError(null)
    setAiAnswer(null)
    try {
      const request = buildSuggestionRequest(
        'Suggest a warehouse grouping structure for this company.',
        rows,
        warehouses,
      )
      setAiAnswer(await warehouseGroupsAi.suggest(request))
    } catch (err) {
      setAiError(
        err instanceof AiUnavailableError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'The AI service did not answer. Try again in a moment.',
      )
    } finally {
      setAiBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Card padding="sm">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="inline-flex items-center gap-1.5 text-sm font-bold text-gray-900">
            <Network className="h-4 w-4 text-gray-400" aria-hidden />
            Group structure
          </h2>
          <Button variant="link" size="xs" onClick={onViewAll}>
            View all
          </Button>
        </div>

        {loading && rows.length === 0 ? (
          <div className="space-y-1.5" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="skeleton h-5 rounded" style={{ marginLeft: `${(i % 2) * 0.875}rem` }} />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="px-1 py-2 text-xs text-gray-500">No groups yet — the structure appears here as you add them.</p>
        ) : (
          <>
            <p className="px-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              All warehouse groups ({stats.total})
            </p>
            <ul className="list-none p-0">
              {forest.map((node) => (
                <StructureRow key={node.id} node={node} depth={0} onOpen={onOpen} />
              ))}
            </ul>
            {stats.ungrouped !== null && stats.ungrouped > 0 && canReadWarehouses ? (
              <Link
                to={warehousesRoute}
                className="mt-1.5 flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] text-gray-500 no-underline transition-colors hover:bg-gray-50 hover:text-primary"
              >
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-amber-50 text-amber-600" aria-hidden>
                  <Boxes className="h-3 w-3" />
                </span>
                <span className="min-w-0 flex-1 truncate">Ungrouped warehouses</span>
                <span className="shrink-0 font-semibold tabular-nums">({stats.ungrouped})</span>
              </Link>
            ) : null}
          </>
        )}
      </Card>

      <Card padding="sm">
        <div className="mb-1 flex items-center gap-1.5">
          <span className="grid h-6 w-6 place-items-center rounded-lg bg-violet-50 text-violet-600" aria-hidden>
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <h2 className="text-sm font-bold text-gray-900">Aicountly AI</h2>
          <Badge tone="beta" size="xs">Beta</Badge>
        </div>
        <p className="mb-3 text-[11px] text-gray-500">Get insights and suggestions</p>

        <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3">
          <p className="m-0 text-xs font-semibold text-gray-800">Need help organising your warehouses?</p>
          <p className="m-0 mt-1 text-[11px] leading-relaxed text-gray-500">
            Aicountly AI can suggest a grouping structure from your locations and inventory operations.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2.5"
            icon={Sparkles}
            onClick={generate}
            loading={aiBusy}
            disabled={!warehouseGroupsAi.configured || rows.length === 0}
            title={warehouseGroupsAi.configured ? undefined : 'The Aicountly AI service is not connected to this build'}
          >
            Generate suggestion
          </Button>
          {!warehouseGroupsAi.configured ? (
            <p className="m-0 mt-2 text-[11px] leading-relaxed text-gray-500">
              AI suggestions will be available when the Aicountly AI service is connected. Everything else on this
              screen works without it.
            </p>
          ) : null}
        </div>

        {aiError ? (
          <Notice kind="info" className="mt-2">
            {aiError}
          </Notice>
        ) : null}

        {aiAnswer ? (
          <div className="mt-2 rounded-lg border border-gray-200 p-3">
            <p className="m-0 text-xs font-semibold text-gray-800">{aiAnswer.headline}</p>
            <p className="m-0 mt-1 whitespace-pre-line text-[11px] leading-relaxed text-gray-600">{aiAnswer.body}</p>
            {aiAnswer.groups?.length ? (
              <ul className="mt-2 list-none space-y-1 p-0">
                {aiAnswer.groups.map((g) => (
                  <li key={g.name} className="text-[11px] text-gray-600">
                    <strong className="text-gray-800">{g.name}</strong>
                    {g.code ? <span className="ml-1 font-mono text-gray-400">{g.code}</span> : null}
                    {g.rationale ? <span className="block text-gray-500">{g.rationale}</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <div className="mt-3 border-t border-gray-100 pt-2">
          <h3 className="mb-1 inline-flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            <Lightbulb className="h-3 w-3" aria-hidden />
            Insights
          </h3>
          {loading && rows.length === 0 ? (
            <div className="space-y-1.5" aria-hidden>
              <div className="skeleton h-9 rounded" />
              <div className="skeleton h-9 rounded" />
            </div>
          ) : insights.length === 0 ? (
            <p className="px-1 py-1.5 text-[11px] leading-relaxed text-gray-500">
              {rows.length === 0
                ? 'Insights appear once there are groups to count.'
                : 'Nothing stands out: every group holds warehouses, the names are distinct and none of the inactive ones are still in use.'}
            </p>
          ) : (
            <ul className="list-none space-y-0.5 p-0">
              {insights.map((insight) => {
                const tone = TONE_STYLES[insight.tone]
                const clickable = Boolean(insight.filters)
                const body = (
                  <>
                    <span className="flex items-start gap-1.5">
                      <span className={cx('mt-1 h-1.5 w-1.5 shrink-0 rounded-full', tone.dot)} aria-hidden />
                      <span className={cx('text-[11px] font-semibold', tone.text)}>{insight.title}</span>
                    </span>
                    <span className="mt-0.5 block pl-3 text-[11px] leading-relaxed text-gray-500">{insight.detail}</span>
                  </>
                )
                return (
                  <li key={insight.id}>
                    {clickable ? (
                      <button
                        type="button"
                        onClick={() => onApplyFilters(insight.filters as Partial<FilterState>)}
                        className="w-full rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                      >
                        {body}
                        <span className="mt-1 inline-flex items-center gap-1 pl-3 text-[11px] font-semibold text-primary">
                          Show these
                          <ArrowRight className="h-3 w-3" aria-hidden />
                        </span>
                      </button>
                    ) : (
                      <div className="px-1.5 py-1.5">{body}</div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="mt-2 border-t border-gray-100 pt-2">
          <h3 className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Quick views</h3>
          <div className="flex flex-col">
            <button type="button" className="rounded-md px-1.5 py-1 text-left text-[11px] text-gray-600 transition-colors hover:bg-gray-50 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30" onClick={() => onApplyFilters({ contents: 'empty' })}>
              Groups with no warehouses
            </button>
            <button type="button" className="rounded-md px-1.5 py-1 text-left text-[11px] text-gray-600 transition-colors hover:bg-gray-50 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30" onClick={() => onApplyFilters({ contents: 'with', sort: 'warehouses_desc' })}>
              Largest groups first
            </button>
            <button type="button" className="rounded-md px-1.5 py-1 text-left text-[11px] text-gray-600 transition-colors hover:bg-gray-50 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30" onClick={() => onApplyFilters({ status: 'inactive' })}>
              Inactive groups
            </button>
            <button type="button" className="rounded-md px-1.5 py-1 text-left text-[11px] text-gray-600 transition-colors hover:bg-gray-50 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30" onClick={() => onApplyFilters({ level: 'child' })}>
              Sub-groups only
            </button>
            {canReadWarehouses ? (
              <Link to={warehousesRoute} className="rounded-md px-1.5 py-1 text-left text-[11px] text-gray-600 no-underline transition-colors hover:bg-gray-50 hover:text-primary">
                Show ungrouped warehouses
              </Link>
            ) : null}
          </div>
        </div>
      </Card>
    </div>
  )
}

export default WarehouseGroupsSidePanel
