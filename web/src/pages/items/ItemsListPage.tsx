/**
 * `/items`.
 *
 * The screen itself is `ItemsPage`. This module stays as the route's entry
 * point and re-exports `itemsConfig`, which is the single column list the CSV,
 * the Excel workbook, the PDF and the letterheaded print sheet are all built
 * from — `masters/realMasterExports.test.tsx` imports it from here.
 */
export { itemsConfig } from './itemsConfig'
export { ItemsPage as ItemsListPage } from './ItemsPage'
