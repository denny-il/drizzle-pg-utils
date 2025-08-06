import { SQL } from 'drizzle-orm'
import { customType } from 'drizzle-orm/pg-core'
import type { Temporal } from 'temporal-spec'
import type { TemporalColumn } from '../types.ts'
import type { TimeConfig } from './timestamp.ts'

type Config = {
  data: Temporal.PlainTime
  driverData: string
  config?: TimeConfig
}

export type TemporalTimeType = TemporalColumn<{
  config: Config
  constraints: false
}>

/**
 * Creates a PostgreSQL time column type for Temporal.PlainTime values.
 * Represents a time of day without date or timezone information.
 *
 * @param Temporal - The Temporal implementation to use
 * @returns Column factory function
 */
export function createTime(
  Temporal: typeof import('temporal-spec').Temporal,
): TemporalTimeType {
  return {
    column: customType<Config>({
      dataType: (config?: TimeConfig) =>
        `time${typeof config?.precision !== 'undefined' ? ` (${config.precision})` : ''}`,
      fromDriver: (val: string) => Temporal.PlainTime.from(val),
      toDriver: (val: Temporal.PlainTime | SQL) =>
        val instanceof SQL ? val : val.toString(),
    }),
  }
}
