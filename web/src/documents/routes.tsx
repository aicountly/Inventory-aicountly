import { Route } from 'react-router-dom'
import type { RouteObject } from 'react-router-dom'
import { PackingListsPage } from '../pages/PackingListsPage'
import { PendingQuantitiesPage } from '../pages/PendingQuantitiesPage'
import { ReservationsPage } from '../pages/ReservationsPage'
import { DocumentDetailPage } from './DocumentDetailPage'
import { DocumentFormPage } from './DocumentFormPage'
import { DocumentPrintPage } from './DocumentPrintPage'
import { DocumentsListPage } from './DocumentsListPage'

/**
 * Inventory document screens. Mount inside the authenticated shell (needs CompanyProvider,
 * AccessProvider and a router). Paths are relative to the app root.
 */
export const documentRoutes: RouteObject[] = [
  { path: 'documents', element: <DocumentsListPage /> },
  { path: 'documents/new/:slug', element: <DocumentFormPage /> },
  { path: 'documents/:id', element: <DocumentDetailPage /> },
  { path: 'documents/:id/edit', element: <DocumentFormPage /> },
  { path: 'documents/:id/print', element: <DocumentPrintPage /> },
  { path: 'packing-lists', element: <PackingListsPage /> },
  { path: 'reservations', element: <ReservationsPage /> },
  { path: 'pending-quantities', element: <PendingQuantitiesPage /> },
]

/** The same screens as `<Route>` elements for a JSX `<Routes>` tree. */
export function renderDocumentRoutes() {
  return documentRoutes.map((r) => <Route key={r.path} path={r.path} element={r.element} />)
}

/** Navigation entries for the shell. */
export const documentNavItems = [
  { to: '/documents', label: 'Documents', permission: 'documents.read' },
  { to: '/packing-lists', label: 'Packing lists', permission: ['documents.packing.read', 'documents.read'] },
  { to: '/reservations', label: 'Reservations', permission: ['documents.reservation.read', 'documents.read'] },
  { to: '/pending-quantities', label: 'Pending quantities', permission: 'documents.read' },
] as const
