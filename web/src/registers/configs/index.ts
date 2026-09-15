/**
 * Every register in Inventory, in one list.
 *
 * The eight `/reports/*` configs are here unchanged: a `ReportConfig` is a
 * valid `RegisterConfig`, so they appear on the registers hub, render through
 * the same engine and keep their own `/reports/<path>` URLs working for any
 * bookmark or link that already points at them.
 */

import type { AnyRegisterConfig, RegisterGroup } from '../RegisterConfig'
import { REPORT_CONFIGS } from '../../reports/configs'
import {
  movementRegister,
  stockBalanceRegister,
  stockLedgerRegister,
} from './stockRegisters'
import {
  pendingRegister,
  reconciliationRegister,
  reservationRegister,
  valuationRegister,
} from './opsRegisters'

export {
  movementRegister,
  stockBalanceRegister,
  stockLedgerRegister,
} from './stockRegisters'
export {
  pendingRegister,
  reconciliationRegister,
  reservationRegister,
  valuationRegister,
  differenceTone,
} from './opsRegisters'

/** Registers that live only here (the reports keep their own module). */
export const NATIVE_REGISTERS: AnyRegisterConfig[] = [
  stockLedgerRegister,
  movementRegister,
  stockBalanceRegister,
  valuationRegister,
  reservationRegister,
  pendingRegister,
  reconciliationRegister,
]

export const REGISTER_CONFIGS: AnyRegisterConfig[] = [...NATIVE_REGISTERS, ...REPORT_CONFIGS]

export function registerByPath(path: string): AnyRegisterConfig | undefined {
  return REGISTER_CONFIGS.find((c) => (c.routePath ?? c.path) === path)
}

export const REGISTER_GROUP_ORDER: RegisterGroup[] = [
  'movement',
  'stock',
  'valuation',
  'analysis',
  'compliance',
]

export const REGISTER_GROUP_LABELS: Record<RegisterGroup, string> = {
  movement: 'Movement',
  stock: 'Stock position',
  valuation: 'Valuation',
  analysis: 'Analysis',
  compliance: 'Commitments and control',
}

export const REGISTER_GROUP_DESCRIPTIONS: Record<RegisterGroup, string> = {
  movement: 'What moved, when, and which document caused it.',
  stock: 'What is on hand right now, and where.',
  valuation: 'What the stock is worth, and on what basis.',
  analysis: 'Ageing, movement classes, expiry and replenishment.',
  compliance: 'Commitments, open quantities and the reconciliation trail.',
}

/** Registers of one group, in declaration order. Ungrouped fall into Analysis. */
export function registersInGroup(group: RegisterGroup): AnyRegisterConfig[] {
  return REGISTER_CONFIGS.filter((c) => (c.group ?? 'analysis') === group)
}
