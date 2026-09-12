import type { ReportConfig } from '../types'
import { movementAnalysisConfig, nearExpiryConfig, replenishmentConfig, stockAgeingConfig } from './analysisReports'
import { batchStockConfig, serialStockConfig, stockSummaryConfig, warehouseStockConfig } from './stockReports'

/* eslint-disable @typescript-eslint/no-explicit-any */
export const REPORT_CONFIGS: ReportConfig<any, any>[] = [
  stockSummaryConfig,
  warehouseStockConfig,
  batchStockConfig,
  serialStockConfig,
  stockAgeingConfig,
  movementAnalysisConfig,
  nearExpiryConfig,
  replenishmentConfig,
]

export function reportByPath(path: string): ReportConfig<any, any> | undefined {
  return REPORT_CONFIGS.find((c) => c.path === path)
}
