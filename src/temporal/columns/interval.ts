import { SQL } from 'drizzle-orm'
import { customType, type IntervalConfig } from 'drizzle-orm/pg-core'
import type { TemporalColumn } from '../types.ts'

type Config<T extends typeof globalThis.Temporal> = {
  data: InstanceType<T['Duration']>
  driverData: string
  config?: IntervalConfig
}

export type TemporalIntervalType<T extends typeof globalThis.Temporal> =
  TemporalColumn<{
    config: Config<T>
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
export function createInterval<T extends typeof globalThis.Temporal>(
  Temporal: T,
  options?: globalThis.Temporal.DurationToStringOptions,
): TemporalIntervalType<T> {
  return {
    column: customType<Config<T>>({
      dataType: (config?: IntervalConfig) =>
        `interval${config?.fields ? ` ${config.fields}` : ''}${typeof config?.precision !== 'undefined' ? ` (${config.precision})` : ''}`,
      fromDriver: (val: string) =>
        Temporal.Duration.from(val) as InstanceType<T['Duration']>,
      toDriver: (val: InstanceType<T['Duration']> | SQL) =>
        val instanceof SQL ? val : val.toString({ ...options }),
    }),
  }
}
