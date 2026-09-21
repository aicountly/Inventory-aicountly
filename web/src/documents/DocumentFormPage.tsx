import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAccess } from '../access/AccessContext'
import { Notice } from '../components/Notice'
import { useQuery } from '../hooks/useQuery'
import { errorMessage } from '../services/api'
import { documentsApi } from '../services/documentsApi'
import type { BadgeTone } from '../ui/Badge'
import { Badge } from '../ui/Badge'
import { BreadcrumbHeader } from '../ui/shell/BreadcrumbHeader'
import { PageShell } from '../ui/shell/PageShell'
import { DocumentForm } from './DocumentForm'
import { ConsumptionForm } from './consumption/ConsumptionForm'
import { MaterialIssuePage } from './materialIssue/MaterialIssuePage'
import { StockTransferWorkspace } from './transfer/StockTransferWorkspace'
import { canCreate, isEditable, permissionKeysFor, STATUS_LABELS, statusTone } from './actions'
import type { StatusTone } from './actions'
import { documentTypeGlyph } from './documentTypeIcon'
import { draftFromDocument } from './formModel'
import { specForCode, specForSlug, UNAVAILABLE_TYPES } from './registry'
import type { DocumentStatus } from './types'
import './documents.css'

/*
 * Three native types have a screen of their own; every other one keeps the
 * shared `DocumentForm`. A type earns one when the generic editor cannot say
 * what it needs to say while the document is being typed — a transfer has two
 * warehouses on the header and a route per line, a consumption has to settle
 * batches and serials before it can be saved at all, a material issue has to
 * show what is on hand where each line posts — and the alternative is finding
 * out when the API refuses it.
 */

const STATUS_BADGE_TONE: Record<StatusTone, BadgeTone> = { neutral: 'neutral', info: 'info', success: 'success', warning: 'warning', danger: 'danger' }

/** `/documents/new/:slug` and `/documents/:id/edit`. */
export function DocumentFormPage() {
  const { slug, id } = useParams()
  const navigate = useNavigate()
  const { can } = useAccess()
  const documentId = id ? Number(id) : null
  const editing = documentId !== null && Number.isFinite(documentId)

  const existing = useQuery((signal) => documentsApi.get(documentId as number, signal), [documentId], { enabled: editing, keepData: false })

  const spec = editing ? specForCode(existing.data?.document_type) : specForSlug(slug)
  const crumbs = [{ label: 'Documents', to: '/documents' }]
  const icon = documentTypeGlyph(editing ? existing.data?.document_type : spec?.code).icon

  if (!editing && !spec) {
    return (
      <PageShell>
        <BreadcrumbHeader breadcrumbs={crumbs} title="Unknown document type" escBack={false} />
        <Notice kind="error">There is no native document type for &ldquo;{slug}&rdquo;.</Notice>
      </PageShell>
    )
  }
  if (!editing && spec && UNAVAILABLE_TYPES.has(spec.code)) {
    return (
      <PageShell>
        <BreadcrumbHeader breadcrumbs={crumbs} title={spec.label} icon={icon} escBack={false} />
        <Notice kind="warning">A {spec.label.toLowerCase()} cannot be created: the type is declared but nothing happens when it posts, so the document would record work it never did.</Notice>
      </PageShell>
    )
  }
  if (!editing && spec && !canCreate(spec.code, can)) {
    return (
      <PageShell>
        <BreadcrumbHeader breadcrumbs={crumbs} title={spec.label} icon={icon} escBack={false} />
        <Notice kind="warning">You do not have permission to create a {spec.label.toLowerCase()}.</Notice>
      </PageShell>
    )
  }
  if (editing) {
    if (existing.loading && !existing.data) {
      return (
        <PageShell>
          <BreadcrumbHeader breadcrumbs={crumbs} title="Loading…" escBack={false} />
        </PageShell>
      )
    }
    if (existing.error || !existing.data) {
      return (
        <PageShell>
          <BreadcrumbHeader breadcrumbs={crumbs} title="Document" escBack={false} />
          <Notice kind="error">{existing.error ? errorMessage(existing.error) : 'Document not found.'}</Notice>
        </PageShell>
      )
    }
    const doc = existing.data
    if (!spec) {
      return (
        <PageShell>
          <BreadcrumbHeader breadcrumbs={[...crumbs, { label: doc.document_no ?? `#${doc.document_id}`, to: `/documents/${doc.document_id}` }]} title={doc.document_type_label ?? doc.document_type} icon={icon} escBack={false} />
          <Notice kind="info">This document was created by {doc.source_app} and is edited there, not in Inventory.</Notice>
        </PageShell>
      )
    }
    if (!isEditable(doc.status)) {
      return (
        <PageShell>
          <BreadcrumbHeader
            breadcrumbs={crumbs}
            title={`${spec.label} ${doc.document_no ?? `#${doc.document_id}`}`}
            icon={icon}
            escBack={false}
            actions={
              <Link className="btn btn-sm" to={`/documents/${doc.document_id}`}>
                Open
              </Link>
            }
          />
          <Notice kind="warning">A {STATUS_LABELS[doc.status as DocumentStatus]?.toLowerCase() ?? doc.status} document cannot be edited.</Notice>
        </PageShell>
      )
    }
    if (!can(permissionKeysFor('edit', doc.document_type))) {
      return (
        <PageShell>
          <BreadcrumbHeader breadcrumbs={crumbs} title={`${spec.label} ${doc.document_no ?? `#${doc.document_id}`}`} icon={icon} escBack={false} />
          <Notice kind="warning">You do not have permission to edit documents.</Notice>
        </PageShell>
      )
    }
    const initial = draftFromDocument(doc, spec)
    const reapproval = doc.status === 'APPROVED' || doc.status === 'PENDING_APPROVAL'
      ? <Notice kind="info">Saving changes returns the document to draft; it will need approval again.</Notice>
      : null
    if (spec.code === 'STOCK_TRANSFER') {
      return (
        <StockTransferWorkspace
          key={doc.document_id}
          spec={spec}
          documentId={doc.document_id}
          initial={initial}
          existing={doc}
          onSaved={(saved) => navigate(`/documents/${saved.document_id}`)}
        />
      )
    }
    if (spec.code === 'CONSUMPTION') {
      return (
        <ConsumptionForm
          key={doc.document_id}
          spec={spec}
          documentId={doc.document_id}
          initial={initial}
          existingStatus={doc.status}
          existingVersion={doc.version}
          onSaved={(saved) => navigate(`/documents/${saved.document_id}`)}
        />
      )
    }
    if (spec.code === 'MATERIAL_ISSUE') {
      return (
        <MaterialIssuePage
          key={doc.document_id}
          spec={spec}
          documentId={doc.document_id}
          initial={initial}
          documentNo={doc.document_no}
          status={doc.status as DocumentStatus}
          notice={reapproval}
          onSaved={(saved) => navigate(`/documents/${saved.document_id}`)}
        />
      )
    }
    return (
      <PageShell paddingBottom>
        <BreadcrumbHeader
          breadcrumbs={[...crumbs, { label: doc.document_no ?? `#${doc.document_id}`, to: `/documents/${doc.document_id}` }]}
          title={`Edit ${spec.label.toLowerCase()} ${doc.document_no ?? `#${doc.document_id}`}`}
          description={spec.description}
          icon={icon}
          badge={<Badge tone={STATUS_BADGE_TONE[statusTone(doc.status)]}>{STATUS_LABELS[doc.status as DocumentStatus] ?? doc.status}</Badge>}
          meta={<span className="text-xs text-gray-500">Version {doc.version}</span>}
          escBack={false}
        />
        {reapproval}
        <DocumentForm key={doc.document_id} spec={spec} documentId={doc.document_id} initial={initial} onSaved={(saved) => navigate(`/documents/${saved.document_id}`)} />
      </PageShell>
    )
  }

  const s = spec as NonNullable<typeof spec>
  if (s.code === 'STOCK_TRANSFER') {
    return <StockTransferWorkspace key={s.code} spec={s} onSaved={(saved) => navigate(`/documents/${saved.document_id}`)} />
  }
  if (s.code === 'CONSUMPTION') {
    return <ConsumptionForm key={s.code} spec={s} onSaved={(saved) => navigate(`/documents/${saved.document_id}`)} />
  }
  if (s.code === 'MATERIAL_ISSUE') {
    return <MaterialIssuePage key={s.code} spec={s} onSaved={(saved) => navigate(`/documents/${saved.document_id}`)} />
  }
  return (
    <PageShell paddingBottom>
      <BreadcrumbHeader
        breadcrumbs={crumbs}
        title={`New ${s.label.toLowerCase()}`}
        description={s.description}
        icon={icon}
        badge={<Badge tone="info">Draft</Badge>}
        escBack={false}
      />
      <DocumentForm key={s.code} spec={s} onSaved={(saved) => navigate(`/documents/${saved.document_id}`)} />
    </PageShell>
  )
}
