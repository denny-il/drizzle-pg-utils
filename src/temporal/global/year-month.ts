/// <reference types="temporal-spec/global" />
import {
  createYearMonth,
  type TemporalYearMonthType,
} from '../columns/year-month.ts'

export const yearMonth: TemporalYearMonthType = createYearMonth(
  globalThis.Temporal,
)
