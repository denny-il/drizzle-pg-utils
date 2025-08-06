import { SQL } from 'drizzle-orm'
import { customType } from 'drizzle-orm/pg-core'
import type { Temporal } from 'temporal-spec'
import type { TemporalColumn } from '../types.ts'

/**
 * Configuration options for time-based columns.
 */
export type TimeConfig = {
  /** The precision (number of fractional digits) for time values. */
  precision?: number
}

type Config = {
  data: Temporal.PlainDateTime
  driverData: string
  config?: TimeConfig
}

export type TemporalTimestampType = TemporalColumn<{
  config: Config
  constraits: false
}>

/**
 * Creates a PostgreSQL timestamp column type for Temporal.PlainDateTime values.
 * Represents a date and time without timezone information.
 *
 * @param Temporal - The Temporal implementation to use
 * @returns Column factory function
 */
export function createTimestamp(
  Temporal: typeof import('temporal-spec').Temporal,
): TemporalTimestampType {
  return {
    column: customType<Config>({
      dataType: (config?: TimeConfig) =>
        `timestamp${typeof config?.precision !== 'undefined' ? ` (${config.precision})` : ''}`,
      fromDriver: (val: string) => Temporal.PlainDateTime.from(val),
      toDriver: (val: Temporal.PlainDateTime | SQL) =>
        val instanceof SQL ? val : val.toString({ calendarName: 'never' }),
    }),
  }
}
