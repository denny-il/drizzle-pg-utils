import { Temporal } from 'temporal-polyfill'
import {
  createTimestamp,
  type TemporalTimestampType,
} from '../columns/timestamp.ts'

export const timestamp: TemporalTimestampType = createTimestamp(Temporal)
