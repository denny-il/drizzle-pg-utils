import { Temporal } from 'temporal-polyfill'
import { createInterval } from './columns/interval.ts'
import { createMonthDay } from './columns/month-day.ts'
import { createPlainDate } from './columns/plain-date.ts'
import { createTime } from './columns/time.ts'
import { createTimestamp } from './columns/timestamp.ts'
import { createTimestampz } from './columns/timestampz.ts'
import { createYearMonth } from './columns/year-month.ts'

export const interval = createInterval(
  // @ts-expect-error
  Temporal,
)
export const monthDay = createMonthDay(
  // @ts-expect-error
  Temporal,
)
export const plainDate = createPlainDate(
  // @ts-expect-error
  Temporal,
)
export const time = createTime(
  // @ts-expect-error
  Temporal,
)
export const timestamp = createTimestamp(
  // @ts-expect-error
  Temporal,
)
export const timestampz = createTimestampz(
  // @ts-expect-error
  Temporal,
)
export const yearMonth = createYearMonth(
  // @ts-expect-error
  Temporal,
)
