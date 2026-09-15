import type { RegisterConfig } from '../../registers/RegisterConfig'
import { movementAnalysisConfig, nearExpiryConfig, replenishmentConfig, stockAgeingConfig } from './analysisReports'
import { batchStockConfig, serialStockConfig, stockSummaryConfig, warehouseStockConfig } from './stockReports'

/* eslint-disable @typescript-eslint/no-explicit-any */
export const REPORT_CONFIGS: RegisterConfig<any, any>[] = [
  stockSummaryConfig,
  warehouseStockConfig,
  batchStockConfig,
  serialStockConfig,
  stockAgeingConfig,
  movementAnalysisConfig,
  nearExpiryConfig,
  replenishmentConfig,
]

export function reportByPath(path: string): RegisterConfig<any, any> | undefined {
  return REPORT_CONFIGS.find((c) => c.path === path)
}
