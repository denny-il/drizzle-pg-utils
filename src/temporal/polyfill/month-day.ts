import { Temporal } from 'temporal-polyfill'
import {
  createMonthDay,
  type TemporalMonthDayType,
} from '../columns/month-day.ts'

export const monthDay: TemporalMonthDayType = createMonthDay(Temporal)
