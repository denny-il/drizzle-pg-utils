import { SQL } from 'drizzle-orm'
import { customType, type IntervalConfig } from 'drizzle-orm/pg-core'
import type { Temporal } from 'temporal-spec'
import type { TemporalColumn } from '../types.ts'

type Config = {
  data: Temporal.Duration
  driverData: string
  config?: IntervalConfig
}

export type TemporalIntervalType = TemporalColumn<{
  config: Config
  constraints: false
}>

/**
 * Creates a PostgreSQL interval column type for Temporal.Duration values.
 * Represents a time span or duration between two points in time.
 *
 * @requires PostgreSQL intervalstyle set to 'iso_8601'
 * @see https://www.postgresql.org/docs/current/datatype-datetime.html#DATATYPE-INTERVAL-OUTPUT
 *
 * @param Temporal - The Temporal implementation to use
 * @returns Column factory function
 */
export function createInterval(
  Temporal: typeof import('temporal-spec').Temporal,
): TemporalIntervalType {
  return {
    column: customType<Config>({
      dataType: (config?: IntervalConfig) =>
        `interval${config?.fields ? ` ${config.fields}` : ''}${typeof config?.precision !== 'undefined' ? ` (${config.precision})` : ''}`,
      fromDriver: (val: string) => Temporal.Duration.from(val),
      toDriver: (val: Temporal.Duration | SQL) =>
        val instanceof SQL ? val : val.toString(),
    }),
  }
}
