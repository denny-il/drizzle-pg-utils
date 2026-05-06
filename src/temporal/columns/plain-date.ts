import { SQL } from 'drizzle-orm'
import { customType } from 'drizzle-orm/pg-core'

import type { TemporalColumn } from '../types.ts'

type Config<T extends typeof globalThis.Temporal> = {
  data: InstanceType<T['PlainDate']>
  driverData: string
}

export type TemporalPlainDateType<T extends typeof globalThis.Temporal> =
  TemporalColumn<{
    config: Config<T>
    constraints: false
  }>

/**
 * Creates a PostgreSQL date column type for Temporal.PlainDate values.
 * Represents a calendar date without time or timezone information.
 *
 * @param Temporal - The Temporal implementation to use
 * @returns Column factory function
 */
export function createPlainDate<T extends typeof globalThis.Temporal>(
  Temporal: T,
  options?: globalThis.Temporal.PlainDateToStringOptions,
): TemporalPlainDateType<T> {
  return {
    column: customType<Config<T>>({
      dataType: () => 'date',
      fromDriver: (val: string) =>
        Temporal.PlainDate.from(val) as InstanceType<T['PlainDate']>,
      toDriver: (val: InstanceType<T['PlainDate']> | SQL) =>
        val instanceof SQL ? val : val.toString({ ...options }),
    }),
  }
}
