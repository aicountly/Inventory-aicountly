import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAccess } from '../access/AccessContext'
import { Notice } from '../components/Notice'
import { PageHeader } from '../components/PageHeader'
import { useQuery } from '../hooks/useQuery'
import { errorMessage } from '../services/api'
import { documentsApi } from '../services/documentsApi'
import { DocumentForm } from './DocumentForm'
import { canCreate, isEditable, permissionKeysFor, STATUS_LABELS } from './actions'
import { draftFromDocument } from './formModel'
import { specForCode, specForSlug } from './registry'
import type { DocumentStatus } from './types'
import './documents.css'

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

  if (!editing && !spec) {
    return (
      <div className="page">
        <PageHeader title="Unknown document type" breadcrumbs={crumbs} />
        <Notice kind="error">There is no native document type for &ldquo;{slug}&rdquo;.</Notice>
      </div>
    )
  }
  if (!editing && spec && !canCreate(spec.code, can)) {
    return (
      <div className="page">
        <PageHeader title={spec.label} breadcrumbs={crumbs} />
        <Notice kind="warning">You do not have permission to create a {spec.label.toLowerCase()}.</Notice>
      </div>
    )
  }
  if (editing) {
    if (existing.loading && !existing.data) {
      return (
        <div className="page">
          <PageHeader title="Loading…" breadcrumbs={crumbs} />
        </div>
      )
    }
    if (existing.error || !existing.data) {
      return (
        <div className="page">
          <PageHeader title="Document" breadcrumbs={crumbs} />
          <Notice kind="error">{existing.error ? errorMessage(existing.error) : 'Document not found.'}</Notice>
        </div>
      )
    }
    const doc = existing.data
    if (!spec) {
      return (
        <div className="page">
          <PageHeader title={doc.document_type_label ?? doc.document_type} breadcrumbs={[...crumbs, { label: doc.document_no ?? `#${doc.document_id}`, to: `/documents/${doc.document_id}` }]} />
          <Notice kind="info">This document was created by {doc.source_app} and is edited there, not in Inventory.</Notice>
        </div>
      )
    }
    if (!isEditable(doc.status)) {
      return (
        <div className="page">
          <PageHeader title={`${spec.label} ${doc.document_no ?? `#${doc.document_id}`}`} breadcrumbs={crumbs} />
          <Notice kind="warning" actions={<Link className="btn btn-sm" to={`/documents/${doc.document_id}`}>Open</Link>}>
            A {STATUS_LABELS[doc.status as DocumentStatus]?.toLowerCase() ?? doc.status} document cannot be edited.
          </Notice>
        </div>
      )
    }
    if (!can(permissionKeysFor('edit', doc.document_type))) {
      return (
        <div className="page">
          <PageHeader title={`${spec.label} ${doc.document_no ?? `#${doc.document_id}`}`} breadcrumbs={crumbs} />
          <Notice kind="warning">You do not have permission to edit documents.</Notice>
        </div>
      )
    }
    const initial = draftFromDocument(doc, spec)
    return (
      <div className="page">
        <PageHeader title={`Edit ${spec.label.toLowerCase()} ${doc.document_no ?? `#${doc.document_id}`}`} subtitle={`Version ${doc.version} · ${STATUS_LABELS[doc.status as DocumentStatus] ?? doc.status}`} breadcrumbs={[...crumbs, { label: doc.document_no ?? `#${doc.document_id}`, to: `/documents/${doc.document_id}` }]} />
        {doc.status === 'APPROVED' || doc.status === 'PENDING_APPROVAL' ? <Notice kind="info">Saving changes returns the document to draft; it will need approval again.</Notice> : null}
        <DocumentForm key={doc.document_id} spec={spec} documentId={doc.document_id} initial={initial} onSaved={(saved) => navigate(`/documents/${saved.document_id}`)} />
      </div>
    )
  }

  const s = spec as NonNullable<typeof spec>
  return (
    <div className="page">
      <PageHeader title={`New ${s.label.toLowerCase()}`} breadcrumbs={crumbs} />
      <DocumentForm key={s.code} spec={s} onSaved={(saved) => navigate(`/documents/${saved.document_id}`)} />
    </div>
  )
}
