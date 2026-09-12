import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAccess } from '../access/AccessContext'
import { useCompany } from '../company/CompanyContext'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { DataTable } from '../components/DataTable'
import type { Column } from '../components/DataTable'
import { Modal } from '../components/Modal'
import { Notice } from '../components/Notice'
import { PageHeader } from '../components/PageHeader'
import { Pagination } from '../components/Pagination'
import { SearchInput } from '../components/SearchInput'
import { useFormOptions, invalidateFormOptions } from '../hooks/useFormOptions'
import { useListParams } from '../hooks/useListParams'
import { useQuery } from '../hooks/useQuery'
import { P } from '../services/access'
import { errorMessage } from '../services/api'
import type { ListMeta, ListQuery } from '../services/api'
import { useToast } from '../ui/ToastContext'
import { MasterForm } from './MasterForm'
import { defaultPayload, defaultValues } from './formValues'
import { allTreeIds, buildTree, flattenTree } from './tree'
import type { VisibleNode } from './tree'
import type { FormValues, MasterConfig, SelectOption } from './types'

interface MasterPageProps<T> {
  config: MasterConfig<T>
  /** Extra toolbar actions (e.g. "Bulk add"). Receives a reload callback. */
  extraActions?: (ctx: { reload: () => void; canWrite: boolean }) => ReactNode
  /** Extra dialogs rendered by the host page. */
  children?: ReactNode
  breadcrumbs?: { label: string; to?: string }[]
}

type ViewMode = 'tree' | 'list'

const TREE_PAGE = 1000
const TREE_MAX_PAGES = 10

/** Config-driven master screen: list + filters + modal form + soft delete. */
export function MasterPage<T>({ config, extraActions, children, breadcrumbs }: MasterPageProps<T>) {
  const { scope } = useCompany()
  const { can, loading: accessLoading } = useAccess()
  const toast = useToast()
  const navigate = useNavigate()
  const canRead = can(P.masters(config.permissionSlug, 'read'))
  const canWrite = can(P.masters(config.permissionSlug, 'write'))
  const canDelete = can(P.masters(config.permissionSlug, 'delete'))
  const hasActiveFilter = config.hasActiveFilter ?? true
  const needsOptions = config.needsFormOptions ?? true
  const filterKeys = useMemo(() => [...(hasActiveFilter ? ['status'] : []), ...(config.filters ?? []).map((f) => f.name), ...(config.tree ? ['view'] : [])], [hasActiveFilter, config.filters, config.tree])

  const list = useListParams({ sort: config.defaultSort, order: config.defaultOrder, filterKeys })
  const view: ViewMode = config.tree ? (list.state.filters.view === 'list' || list.state.q ? 'list' : 'tree') : 'list'
  const formOptions = useFormOptions()
  const options = needsOptions ? formOptions.options : null

  // ---- data --------------------------------------------------------------
  const listQuery = useMemo<ListQuery>(() => {
    const { view: _view, ...filters } = list.state.filters
    void _view
    return { ...list.query, ...filters, ...(config.listQuery ?? {}) }
  }, [list.query, list.state.filters, config.listQuery])

  const query = useQuery(
    async (signal) => {
      if (view === 'tree') {
        // Every row, so the tree is complete; a very large master is capped.
        const rows: T[] = []
        let meta: ListMeta | null = null
        for (let page = 1; page <= TREE_MAX_PAGES; page += 1) {
          const res = await config.api.list({ ...(config.listQuery ?? {}), status: list.state.filters.status, limit: TREE_PAGE, page, sort: config.defaultSort, order: 'asc' }, signal)
          rows.push(...res.data)
          meta = res.meta
          if (res.data.length < TREE_PAGE || rows.length >= res.meta.total) break
        }
        return { data: rows, meta: meta ?? { total: rows.length, limit: TREE_PAGE, offset: 0 } }
      }
      return config.api.list(listQuery, signal)
    },
    [scope?.cmp_id, scope?.fy_id, scope?.bo_id, listQuery, view],
    { enabled: !!scope && canRead },
  )
  const rows = useMemo(() => query.data?.data ?? [], [query.data])

  // ---- tree state ----------------------------------------------------------
  const tree = useMemo(() => (config.tree && view === 'tree' ? buildTree(rows, { idKey: config.idKey, parentKey: config.tree.parentKey, labelOf: config.nameOf }) : []), [config, rows, view])
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set())
  const [expandedInit, setExpandedInit] = useState(false)
  useEffect(() => {
    if (view === 'tree' && tree.length > 0 && !expandedInit) {
      setExpanded(new Set(allTreeIds(tree)))
      setExpandedInit(true)
    }
  }, [tree, view, expandedInit])
  const visible = useMemo(() => (view === 'tree' ? flattenTree(tree, expanded) : []), [tree, expanded, view])
  const toggleNode = (id: number) =>
    setExpanded((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // ---- form ---------------------------------------------------------------
  const [editing, setEditing] = useState<{ mode: 'create' | 'edit'; row: T | null } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<unknown>(null)
  const formId = `master-form-${config.slug}`

  const openCreate = () => {
    if (config.createRoute) {
      navigate(config.createRoute)
      return
    }
    setSaveError(null)
    setEditing({ mode: 'create', row: null })
  }
  const openEdit = (row: T) => {
    if (config.editRoute) {
      navigate(config.editRoute(row))
      return
    }
    setSaveError(null)
    setEditing({ mode: 'edit', row })
  }
  const closeForm = useCallback(() => {
    if (!saving) setEditing(null)
  }, [saving])

  const afterChange = () => {
    invalidateFormOptions()
    query.reload()
  }

  const submit = async (values: FormValues) => {
    if (!editing) return
    setSaving(true)
    setSaveError(null)
    try {
      const payload = config.toPayload ? config.toPayload(values, editing.row) : defaultPayload(config.fields, values)
      if (editing.mode === 'create') {
        await config.api.create(payload)
        toast.success(`${config.singular} created`)
      } else if (editing.row) {
        await config.api.update(Number((editing.row as Record<string, unknown>)[config.idKey]), payload)
        toast.success(`${config.singular} saved`)
      }
      setEditing(null)
      afterChange()
    } catch (err) {
      setSaveError(err)
    } finally {
      setSaving(false)
    }
  }

  // ---- delete --------------------------------------------------------------
  const [deleting, setDeleting] = useState<T | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const confirmDelete = async () => {
    if (!deleting) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      await config.api.remove(Number((deleting as Record<string, unknown>)[config.idKey]))
      toast.success(`${config.singular} deleted`)
      setDeleting(null)
      afterChange()
    } catch (err) {
      setDeleteError(errorMessage(err))
    } finally {
      setDeleteBusy(false)
    }
  }

  // ---- columns -------------------------------------------------------------
  const columns = useMemo<Column<T>[]>(() => {
    if (view !== 'tree') return config.columns
    const [first, ...rest] = config.columns
    if (!first) return config.columns
    const nodeById = new Map<number, VisibleNode<T>>(visible.map((n) => [n.id, n]))
    const treeFirst: Column<T> = {
      ...first,
      sortKey: undefined,
      render: (row) => {
        const node = nodeById.get(Number((row as Record<string, unknown>)[config.idKey]))
        const depth = node?.depth ?? 0
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center' }}>
            <span className="tree-indent" style={{ width: `${depth * 1.25}rem` }} aria-hidden />
            {node?.hasChildren ? (
              <button type="button" className="tree-toggle" aria-label={node.expanded ? 'Collapse' : 'Expand'} aria-expanded={node.expanded} onClick={(e) => {
                e.stopPropagation()
                toggleNode(node.id)
              }}>
                {node.expanded ? '▼' : '▶'}
              </button>
            ) : (
              <span className="tree-toggle" aria-hidden />
            )}
            {first.render ? first.render(row) : config.nameOf(row)}
          </span>
        )
      },
    }
    return [treeFirst, ...rest]
  }, [config, view, visible])

  const tableRows = view === 'tree' ? visible.map((n) => n.row) : rows
  const idOf = (row: T) => String((row as Record<string, unknown>)[config.idKey])

  if (!accessLoading && !canRead) {
    return (
      <div className="page">
        <PageHeader title={config.title} breadcrumbs={breadcrumbs} />
        <Notice kind="warning">You do not have permission to view {config.title.toLowerCase()} in this company.</Notice>
      </div>
    )
  }

  const filterOptions = (f: NonNullable<MasterConfig<T>['filters']>[number]): SelectOption[] => (typeof f.options === 'function' ? f.options(options) : f.options)

  return (
    <div className="page">
      <PageHeader
        title={config.title}
        breadcrumbs={breadcrumbs}
        subtitle={query.data ? `${query.data.meta.total} ${query.data.meta.total === 1 ? config.singular.toLowerCase() : config.title.toLowerCase()}` : undefined}
        actions={
          <>
            {extraActions?.({ reload: query.reload, canWrite })}
            {canWrite ? (
              <button type="button" className="btn btn-primary" onClick={openCreate}>
                New {config.singular.toLowerCase()}
              </button>
            ) : null}
          </>
        }
      />

      {needsOptions && formOptions.error ? <Notice kind="warning">{formOptions.error}</Notice> : null}

      <div className="toolbar">
        <SearchInput value={list.state.q} onChange={list.setQ} placeholder={config.searchPlaceholder ?? `Search ${config.title.toLowerCase()}…`} />
        {hasActiveFilter ? (
          <select className="select" value={list.state.filters.status ?? ''} onChange={(e) => list.setFilter('status', e.target.value)} aria-label="Active filter">
            <option value="">Active and inactive</option>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
          </select>
        ) : null}
        {(config.filters ?? []).map((f) => (
          <select key={f.name} className="select" value={list.state.filters[f.name] ?? ''} onChange={(e) => list.setFilter(f.name, e.target.value)} aria-label={f.label}>
            <option value="">{f.allLabel ?? `All ${f.label.toLowerCase()}`}</option>
            {filterOptions(f).map((o) => (
              <option key={String(o.value)} value={String(o.value)}>
                {o.label}
              </option>
            ))}
          </select>
        ))}
        {config.tree ? (
          <div className="sub-nav" role="group" aria-label="View">
            <button type="button" className={`btn btn-ghost btn-sm${view === 'tree' ? ' active' : ''}`} onClick={() => list.setFilter('view', '')} disabled={!!list.state.q} title={list.state.q ? 'Clear the search to see the tree' : undefined}>
              Tree
            </button>
            <button type="button" className={`btn btn-ghost btn-sm${view === 'list' ? ' active' : ''}`} onClick={() => list.setFilter('view', 'list')}>
              List
            </button>
          </div>
        ) : null}
        {view === 'tree' && tree.length > 0 ? (
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setExpanded(new Set(allTreeIds(tree)))}>
              Expand all
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setExpanded(new Set())}>
              Collapse all
            </button>
          </>
        ) : null}
        {list.state.q || Object.keys(list.state.filters).length > 0 ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={list.reset}>
            Clear
          </button>
        ) : null}
      </div>

      <DataTable<T>
        columns={columns}
        rows={tableRows}
        rowKey={idOf}
        loading={query.loading}
        error={query.error}
        emptyMessage={config.emptyMessage ?? `No ${config.title.toLowerCase()} yet.`}
        sort={view === 'list' ? { key: list.state.sort, order: list.state.order } : undefined}
        onSort={view === 'list' ? list.toggleSort : undefined}
        onRowClick={openEdit}
        rowActions={(row) => (
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => openEdit(row)}>
              {canWrite ? 'Edit' : 'View'}
            </button>
            {canDelete ? (
              <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => {
                setDeleteError(null)
                setDeleting(row)
              }}>
                Delete
              </button>
            ) : null}
          </>
        )}
      />

      {view === 'list' ? <Pagination meta={query.data?.meta ?? null} limit={list.state.limit} onPage={list.setPage} onLimit={list.setLimit} /> : null}

      <Modal
        open={editing !== null}
        title={editing?.mode === 'create' ? `New ${config.singular.toLowerCase()}` : canWrite ? `Edit ${config.singular.toLowerCase()}` : config.singular}
        onClose={closeForm}
        busy={saving}
        size={config.modalSize}
        footer={
          <>
            <button type="button" className="btn" onClick={closeForm} disabled={saving}>
              {canWrite ? 'Cancel' : 'Close'}
            </button>
            {canWrite ? (
              <button type="submit" form={formId} className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving…' : editing?.mode === 'create' ? 'Create' : 'Save'}
              </button>
            ) : null}
          </>
        }
      >
        {editing ? (
          <MasterForm<T>
            key={`${editing.mode}-${editing.row ? idOf(editing.row) : 'new'}`}
            formId={formId}
            fields={config.fields}
            mode={editing.mode}
            row={editing.row}
            options={options}
            rows={rows}
            initialValues={config.toValues ? config.toValues(editing.row, options) : defaultValues(config.fields, editing.row)}
            readOnly={!canWrite}
            serverError={saveError}
            onSubmit={submit}
          />
        ) : null}
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete ${config.singular.toLowerCase()}?`}
        message={
          <>
            <p style={{ margin: '0 0 0.5rem' }}>
              <strong>{deleting ? config.nameOf(deleting) : ''}</strong> will be {config.hardDelete ? 'removed permanently' : 'removed from every list and dropdown'}.
            </p>
            <p className="muted" style={{ margin: 0, fontSize: '0.875rem' }}>
              {config.deleteHint ?? (config.hardDelete ? 'This cannot be undone.' : 'Records that already reference it keep working; the API refuses the delete while it is still in use.')}
            </p>
          </>
        }
        confirmLabel="Delete"
        danger
        busy={deleteBusy}
        error={deleteError}
        onConfirm={confirmDelete}
        onCancel={() => !deleteBusy && setDeleting(null)}
      />

      {children}
    </div>
  )
}
