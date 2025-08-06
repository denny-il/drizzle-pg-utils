import { Temporal } from 'temporal-polyfill'
import { createTime, type TemporalTimeType } from '../columns/time.ts'

export const time: TemporalTimeType = createTime(Temporal)
