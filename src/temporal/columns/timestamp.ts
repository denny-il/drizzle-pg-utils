import { SQL } from 'drizzle-orm'
import { customType } from 'drizzle-orm/pg-core'

import type { TemporalColumn } from '../types.ts'

/**
 * Configuration options for time-based columns.
 */
export type TimeConfig = {
  /** The precision (number of fractional digits) for time values. */
  precision?: number
}

type Config<T extends typeof globalThis.Temporal> = {
  data: InstanceType<T['PlainDateTime']>
  driverData: string
  config?: TimeConfig
}

export type TemporalTimestampType<T extends typeof globalThis.Temporal> =
  TemporalColumn<{
    config: Config<T>
    constraints: false
  }>

/**
 * Creates a PostgreSQL timestamp column type for Temporal.PlainDateTime values.
 * Represents a date and time without timezone information.
 *
 * @param Temporal - The Temporal implementation to use
 * @returns Column factory function
 */
export function createTimestamp<T extends typeof globalThis.Temporal>(
  Temporal: T,
  options?: globalThis.Temporal.PlainDateTimeToStringOptions,
): TemporalTimestampType<T> {
  return {
    column: customType<Config<T>>({
      codec: 'timestamp:string',
      dataType: (config?: TimeConfig) =>
        `timestamp${typeof config?.precision !== 'undefined' ? ` (${config.precision})` : ''}`,
      fromDriver: (val: string) =>
        Temporal.PlainDateTime.from(val) as InstanceType<T['PlainDateTime']>,
      toDriver: (val: InstanceType<T['PlainDateTime']> | SQL) =>
        val instanceof SQL
          ? val
          : val.toString({ calendarName: 'never', ...options }),
    }),
  }
}
