import { useNavigate } from 'react-router-dom'
import { Copy, ExternalLink, MoreVertical, Pencil, Printer } from 'lucide-react'
import { useAccess } from '../access/AccessContext'
import { MenuButton } from '../ui/MenuButton'
import type { MenuAction } from '../ui/MenuButton'
import { notify } from '../ui/notify'
import { copyText } from '../utils/clipboard'
import { allowedActions } from './actions'
import type { DocumentListRow } from './types'

/**
 * The per-row action menu on the documents register.
 *
 * Every entry is something the app can already do and this user is already
 * allowed to do — Edit is offered exactly when `allowedActions` offers it on
 * the document screen, which is the same status gate and the same permission
 * keys the server enforces. Nothing here is a new capability, and nothing
 * appears that would 403 on the click.
 *
 * The menu itself is `ui/MenuButton`: portalled past the table's own
 * `overflow` so the last row's menu is reachable, with the keyboard behaviour
 * `role="menu"` promises.
 */
export function DocumentRowActions({ row }: { row: DocumentListRow }) {
  const { can } = useAccess()
  const navigate = useNavigate()

  const number = row.document_no ?? `#${row.document_id}`
  const canEdit = allowedActions(row.status, row.document_type, can).includes('edit')

  const actions: MenuAction[] = [
    {
      key: 'open',
      label: 'Open document',
      icon: ExternalLink,
      onSelect: () => navigate(`/documents/${row.document_id}`),
    },
    ...(canEdit
      ? [
          {
            key: 'edit',
            label: 'Edit document',
            icon: Pencil,
            onSelect: () => navigate(`/documents/${row.document_id}/edit`),
          },
        ]
      : []),
    {
      key: 'print',
      label: 'Print document',
      icon: Printer,
      onSelect: () => navigate(`/documents/${row.document_id}/print`),
    },
    {
      key: 'copy',
      label: 'Copy number',
      icon: Copy,
      separated: true,
      // `copyText` falls back to execCommand where `navigator.clipboard` is
      // absent (a plain-HTTP sandbox host), and reports failure rather than
      // throwing — a copy that quietly did nothing leaves the reader pasting
      // whatever they last copied.
      onSelect: () => {
        void copyText(number).then((ok) =>
          ok
            ? notify.success(`${number} copied.`)
            : notify.error('The number could not be copied to the clipboard.'),
        )
      },
    },
  ]

  /*
   * The row opens its document on Enter and takes arrow keys for row-to-row
   * navigation; the trigger sits inside it and must not do both. Stopping the
   * events on a wrapper rather than on the trigger keeps MenuButton's own
   * handlers intact — `buttonProps` is spread last and would replace them.
   */
  return (
    <span
      className="inline-flex"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <MenuButton
        actions={actions}
        label={`Actions for ${number}`}
        icon={MoreVertical}
        width={200}
      />
    </span>
  )
}

export default DocumentRowActions
