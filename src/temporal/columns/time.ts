import { SQL } from 'drizzle-orm'
import { customType } from 'drizzle-orm/pg-core'

import type { TemporalColumn } from '../types.ts'
import type { TimeConfig } from './timestamp.ts'

type Config<T extends typeof globalThis.Temporal> = {
  data: InstanceType<T['PlainTime']>
  driverData: string
  config?: TimeConfig
}

export type TemporalTimeType<T extends typeof globalThis.Temporal> =
  TemporalColumn<{
    config: Config<T>
    constraints: false
  }>

/**
 * Creates a PostgreSQL time column type for Temporal.PlainTime values.
 * Represents a time of day without date or timezone information.
 *
 * @param Temporal - The Temporal implementation to use
 * @returns Column factory function
 */
export function createTime<T extends typeof globalThis.Temporal>(
  Temporal: T,
  options?: globalThis.Temporal.PlainTimeToStringOptions,
): TemporalTimeType<T> {
  return {
    column: customType<Config<T>>({
      dataType: (config?: TimeConfig) =>
        `time${typeof config?.precision !== 'undefined' ? ` (${config.precision})` : ''}`,
      fromDriver: (val: string) =>
        Temporal.PlainTime.from(val) as InstanceType<T['PlainTime']>,
      toDriver: (val: InstanceType<T['PlainTime']> | SQL) =>
        val instanceof SQL ? val : val.toString({ ...options }),
    }),
  }
}
