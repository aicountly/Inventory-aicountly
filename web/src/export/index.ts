/** Printing and export — one pipeline for registers and for documents. */
export { getExportTheme, rgbCss, rgbHex, parseRgbTriple, formatPdfCurrencyLabel } from './exportTheme'
export type { ExportTheme, RGB } from './exportTheme'
export {
  toExportColumns,
  toExportRows,
  toExportCell,
  toExportTotals,
  excelNumberFormat,
  columnWidthPercents,
  isNumericFormat,
  parseFormattedNumber,
} from './exportColumns'
export type { ExportColumn, ExportRow, ExportCell, ExportAlign } from './exportColumns'
export { buildTabularPrintHtml, buildDocumentPrintHtml, buildSheetCss, escapeHtml, nameColumnIndex, totalsLabelIndex } from './sheetHtml'
export type {
  TabularSheetOptions,
  DocumentSheetOptions,
  SheetIdentity,
  SheetSummaryCard,
  SheetBlock,
  SheetPair,
  Orientation,
  PaperSize,
} from './sheetHtml'
export {
  buildExcelAoa,
  exportTabularExcel,
  exportTabularPdf,
  exportDocumentPdf,
  printHtmlDocument,
  printTabular,
  printDocumentSheet,
} from './documentExport'
export type { TabularExportPayload, DocumentExportPayload, ExcelLayout } from './documentExport'
export {
  buildTabularPayload,
  exportRegisterCsv,
  exportRegisterExcel,
  exportRegisterPdf,
  printRegisterSheet,
  runTabularExport,
  exportErrorMessage,
  slugifyExportFilename,
} from './exportActions'
export type { ExportFormat, TabularExportRequest } from './exportActions'
export { ExportActions } from './ExportActions'
export type { ExportActionsProps } from './ExportActions'
export {
  buildDocumentSheet,
  documentColumns,
  documentTotals,
  readLine,
  defaultCopySet,
  COPY_SETS,
  COPY_SET_LABELS,
  GOODS_MOVEMENT_COPIES,
  TWO_PART_COPIES,
} from './documentSheet'
export type { DocumentSheetBody, DocumentSheetInput, DocumentSheetSource, CopySetId } from './documentSheet'
export { useExportIdentity } from './useExportIdentity'
