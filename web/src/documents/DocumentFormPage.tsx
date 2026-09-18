import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAccess } from '../access/AccessContext'
import { Notice } from '../components/Notice'
import { useQuery } from '../hooks/useQuery'
import { errorMessage } from '../services/api'
import { documentsApi } from '../services/documentsApi'
import { Badge } from '../ui/Badge'
import type { BadgeTone } from '../ui/Badge'
import { BreadcrumbHeader } from '../ui/shell/BreadcrumbHeader'
import { PageShell } from '../ui/shell/PageShell'
import { DocumentForm } from './DocumentForm'
import { canCreate, isEditable, permissionKeysFor, STATUS_LABELS } from './actions'
import { heroPresentation } from './entryHub'
import { draftFromDocument } from './formModel'
import { specForCode, specForSlug, UNAVAILABLE_TYPES } from './registry'
import type { DocumentStatus } from './types'

const linkBtn = 'aic inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 no-underline transition-colors hover:border-primary/40 hover:bg-primary-light hover:text-primary'

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
  const { icon, tone } = heroPresentation(spec?.code ?? '')
  const badgeTone: BadgeTone = tone === 'slate' || tone === 'rose' ? 'neutral' : tone

  if (!editing && !spec) {
    return (
      <PageShell>
        <BreadcrumbHeader breadcrumbs={crumbs} title="Unknown document type" />
        <Notice kind="error">There is no native document type for &ldquo;{slug}&rdquo;.</Notice>
      </PageShell>
    )
  }
  if (!editing && spec && UNAVAILABLE_TYPES.has(spec.code)) {
    return (
      <PageShell>
        <BreadcrumbHeader breadcrumbs={[...crumbs, { label: spec.label }]} title={spec.label} icon={icon} iconTone={tone} badge={<Badge tone="neutral">Unavailable</Badge>} />
        <Notice kind="warning">A {spec.label.toLowerCase()} cannot be created: the type is declared but nothing happens when it posts, so the document would record work it never did.</Notice>
      </PageShell>
    )
  }
  if (!editing && spec && !canCreate(spec.code, can)) {
    return (
      <PageShell>
        <BreadcrumbHeader breadcrumbs={[...crumbs, { label: spec.label }]} title={spec.label} icon={icon} iconTone={tone} />
        <Notice kind="warning">You do not have permission to create a {spec.label.toLowerCase()}.</Notice>
      </PageShell>
    )
  }
  if (editing) {
    if (existing.loading && !existing.data) {
      return (
        <PageShell>
          <BreadcrumbHeader breadcrumbs={crumbs} title="Loading…" />
          <div className="h-40 animate-pulse rounded-xl border border-gray-200 bg-gray-50" />
        </PageShell>
      )
    }
    if (existing.error || !existing.data) {
      return (
        <PageShell>
          <BreadcrumbHeader breadcrumbs={crumbs} title="Document" />
          <Notice kind="error">{existing.error ? errorMessage(existing.error) : 'Document not found.'}</Notice>
        </PageShell>
      )
    }
    const doc = existing.data
    if (!spec) {
      return (
        <PageShell>
          <BreadcrumbHeader breadcrumbs={[...crumbs, { label: doc.document_no ?? `#${doc.document_id}`, to: `/documents/${doc.document_id}` }]} title={doc.document_type_label ?? doc.document_type} />
          <Notice kind="info">This document was created by {doc.source_app} and is edited there, not in Inventory.</Notice>
        </PageShell>
      )
    }
    if (!isEditable(doc.status)) {
      return (
        <PageShell>
          <BreadcrumbHeader breadcrumbs={crumbs} title={`${spec.label} ${doc.document_no ?? `#${doc.document_id}`}`} icon={icon} iconTone={tone} />
          <Notice kind="warning" actions={<Link className={linkBtn} to={`/documents/${doc.document_id}`}>Open</Link>}>
            A {STATUS_LABELS[doc.status as DocumentStatus]?.toLowerCase() ?? doc.status} document cannot be edited.
          </Notice>
        </PageShell>
      )
    }
    if (!can(permissionKeysFor('edit', doc.document_type))) {
      return (
        <PageShell>
          <BreadcrumbHeader breadcrumbs={crumbs} title={`${spec.label} ${doc.document_no ?? `#${doc.document_id}`}`} icon={icon} iconTone={tone} />
          <Notice kind="warning">You do not have permission to edit documents.</Notice>
        </PageShell>
      )
    }
    const initial = draftFromDocument(doc, spec)
    return (
      <PageShell paddingBottom>
        <BreadcrumbHeader
          breadcrumbs={[...crumbs, { label: spec.label, to: `/documents?document_type=${spec.code}` }, { label: doc.document_no ?? `#${doc.document_id}` }]}
          title={`Edit ${spec.label.toLowerCase()} ${doc.document_no ?? `#${doc.document_id}`}`}
          description={`Version ${doc.version} · ${STATUS_LABELS[doc.status as DocumentStatus] ?? doc.status}`}
          icon={icon}
          iconTone={tone}
        />
        {doc.status === 'APPROVED' || doc.status === 'PENDING_APPROVAL' ? <Notice kind="info">Saving changes returns the document to draft; it will need approval again.</Notice> : null}
        <DocumentForm key={doc.document_id} spec={spec} documentId={doc.document_id} initial={initial} onSaved={(saved) => navigate(`/documents/${saved.document_id}`)} />
      </PageShell>
    )
  }

  const s = spec as NonNullable<typeof spec>
  return (
    <PageShell paddingBottom>
      <BreadcrumbHeader
        breadcrumbs={[...crumbs, { label: s.label, to: `/documents?document_type=${s.code}` }, { label: 'New' }]}
        title={`New ${s.label.toLowerCase()}`}
        description={s.description}
        icon={icon}
        iconTone={tone}
        badge={<Badge tone={badgeTone}>{s.label}</Badge>}
      />
      <DocumentForm key={s.code} spec={s} onSaved={(saved) => navigate(`/documents/${saved.document_id}`)} />
    </PageShell>
  )
}
