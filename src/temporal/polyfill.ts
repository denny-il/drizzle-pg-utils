import { Temporal } from 'temporal-polyfill'
import { createInterval } from './columns/interval.ts'
import { createMonthDay } from './columns/month-day.ts'
import { createPlainDate } from './columns/plain-date.ts'
import { createTime } from './columns/time.ts'
import { createTimestamp } from './columns/timestamp.ts'
import { createTimestampz } from './columns/timestampz.ts'
import { createYearMonth } from './columns/year-month.ts'

export const interval = createInterval(Temporal)
export const monthDay = createMonthDay(Temporal)
export const plainDate = createPlainDate(Temporal)
export const time = createTime(Temporal)
export const timestamp = createTimestamp(Temporal)
export const timestampz = createTimestampz(Temporal)
export const yearMonth = createYearMonth(Temporal)
