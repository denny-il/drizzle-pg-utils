/// <reference types="temporal-spec/global" />
import {
  createTimestamp,
  type TemporalTimestampType,
} from '../columns/timestamp.ts'

export const timestamp: TemporalTimestampType = createTimestamp(
  globalThis.Temporal,
)
