import { SQL } from 'drizzle-orm'
import { customType } from 'drizzle-orm/pg-core'

import type { TemporalColumn } from '../types.ts'
import type { TimeConfig } from './timestamp.ts'

type Config<T extends typeof globalThis.Temporal> = {
  data: InstanceType<T['Instant']>
  driverData: string
  config?: TimeConfig
}

export type TemporalTimestampzType<T extends typeof globalThis.Temporal> =
  TemporalColumn<{
    config: Config<T>
    constraints: false
  }>

/**
 * Creates a PostgreSQL timestamptz (timestamp with time zone) column type for Temporal.Instant values.
 * Stores absolute instants and decodes them back as Temporal.Instant.
 *
 * @param Temporal - The Temporal implementation to use
 * @returns Column factory function
 */
export function createTimestampz<T extends typeof globalThis.Temporal>(
  Temporal: T,
  options?: globalThis.Temporal.InstantToStringOptions,
): TemporalTimestampzType<T> {
  return {
    column: customType<Config<T>>({
      dataType: (config?: TimeConfig) =>
        `timestamp${typeof config?.precision !== 'undefined' ? ` (${config.precision})` : ''} with time zone`,
      fromDriver: (val: string) =>
        Temporal.Instant.from(val) as InstanceType<T['Instant']>,
      toDriver: (val: InstanceType<T['Instant']> | SQL) =>
        val instanceof SQL
          ? val
          : val.toString({
              ...options,
            }),
    }),
  }
}
