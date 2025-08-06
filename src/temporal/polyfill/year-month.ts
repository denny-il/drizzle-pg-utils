import { Temporal } from 'temporal-polyfill'
import {
  createYearMonth,
  type TemporalYearMonthType,
} from '../columns/year-month.ts'

export const yearMonth: TemporalYearMonthType = createYearMonth(Temporal)
