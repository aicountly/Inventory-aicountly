import { Link } from 'react-router-dom'
import { ArrowLeft, ChevronRight, Eye, MoreHorizontal, Save } from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { MenuButton } from '../../ui/MenuButton'
import type { MenuAction } from '../../ui/MenuButton'
import { AIC, cx } from '../../ui/cx'

/**
 * The top of the workspace: where you are, what you are editing, and the three things you can do.
 *
 * The old screen led with a red **Delete** beside Save. Two buttons of equal weight, one of which
 * destroys a master record that documents point at, is a design that gets an item deleted by
 * somebody reaching for Save. Delete now lives in More Actions, still permission-gated, still
 * behind its confirmation — one deliberate extra step for the one irreversible action.
 */
export interface ItemEditHeaderProps {
  itemName: string
  isNew: boolean
  active: boolean
  /** `#17859 · Last updated on 16 Sep 2026, 10:24 AM by Rahul Gupta` — only what is actually known. */
  meta?: ReactNode
  backTo: string
  moreActions: readonly MenuAction[]
  onViewItem?: () => void
  onSave: () => void
  saving: boolean
  canSave: boolean
  dirty: boolean
  readOnly: boolean
}

export function ItemEditHeader({
  itemName,
  isNew,
  active,
  meta,
  backTo,
  moreActions,
  onViewItem,
  onSave,
  saving,
  canSave,
  dirty,
  readOnly,
}: ItemEditHeaderProps) {
  const crumbName = itemName.trim() || (isNew ? 'New item' : 'Item')
  return (
    <header className={cx(AIC, 'flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between')}>
      <div className="flex min-w-0 items-start gap-3">
        {/*
          A real link, not a history.back(): the unsaved-changes guard watches anchor clicks, so a
          button here would be the one way off this page that silently drops a draft.
        */}
        <Link
          to={backTo}
          aria-label="Back to items"
          className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 no-underline transition-colors hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </Link>

        <div className="min-w-0">
          <nav aria-label="Breadcrumb" className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-gray-500">
            <Link to={backTo} className="no-underline transition-colors hover:text-primary">
              Items
            </Link>
            <ChevronRight className="h-3 w-3 shrink-0 text-gray-300" aria-hidden />
            <span className="max-w-[16rem] truncate">{crumbName}</span>
            <ChevronRight className="h-3 w-3 shrink-0 text-gray-300" aria-hidden />
            <span className="font-semibold text-gray-700" aria-current="page">
              {isNew ? 'New' : 'Edit'}
            </span>
          </nav>

          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold leading-tight tracking-tight text-gray-900 md:text-2xl">
              {isNew ? 'New Item' : 'Edit Item'}
            </h1>
            {/* Never colour alone: the word is the status, the tint only helps find it. */}
            <Badge tone={active ? 'success' : 'neutral'} dot>
              {active ? 'Active' : 'Inactive'}
            </Badge>
            {readOnly ? <Badge tone="info">Read only</Badge> : null}
            {dirty && !readOnly ? <Badge tone="warning">Unsaved changes</Badge> : null}
          </div>

          {meta ? <p className="mt-1 text-xs text-gray-500">{meta}</p> : null}
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 print:hidden">
        {moreActions.length > 0 ? (
          <MenuButton
            actions={moreActions}
            label="More actions"
            icon={MoreHorizontal}
            variant="secondary"
            size="md"
            width={232}
          >
            More Actions
          </MenuButton>
        ) : null}

        {onViewItem ? (
          <Button variant="secondary" size="md" icon={Eye} onClick={onViewItem}>
            View Item
          </Button>
        ) : null}

        {!readOnly ? (
          <Button
            size="md"
            icon={Save}
            kbd="Ctrl S"
            title="Save changes (Ctrl+S)"
            loading={saving}
            disabled={!canSave}
            onClick={onSave}
          >
            {saving ? 'Saving…' : isNew ? 'Create Item' : 'Save Changes'}
          </Button>
        ) : null}
      </div>
    </header>
  )
}

export default ItemEditHeader
