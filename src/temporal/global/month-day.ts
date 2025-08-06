/// <reference types="temporal-spec/global" />
import {
  createMonthDay,
  type TemporalMonthDayType,
} from '../columns/month-day.ts'

export const monthDay: TemporalMonthDayType = createMonthDay(
  globalThis.Temporal,
)
