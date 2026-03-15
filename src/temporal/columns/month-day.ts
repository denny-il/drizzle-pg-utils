import { SQL, sql } from 'drizzle-orm'
import { check, customType } from 'drizzle-orm/pg-core'

import type { TemporalColumn } from '../types.ts'

type Config<T extends typeof globalThis.Temporal> = {
  data: InstanceType<T['PlainMonthDay']>
  driverData: string
}

export type TemporalPlainMonthDayType<T extends typeof globalThis.Temporal> =
  TemporalColumn<{
    config: Config<T>
    constraints: true
  }>

/**
 * Creates a PostgreSQL text column type for Temporal.PlainMonthDay values.
 * Represents a month-day combination (e.g., "07-25") stored as text.
 *
 * @param Temporal - The Temporal implementation to use
 * @returns Column factory function
 */
export function createMonthDay<T extends typeof globalThis.Temporal>(
  Temporal: T,
  options?: globalThis.Temporal.PlainDateToStringOptions,
): TemporalPlainMonthDayType<T> {
  return {
    column: customType<Config<T>>({
      dataType: () => 'text',
      fromDriver: (val: string) =>
        Temporal.PlainMonthDay.from(val) as InstanceType<T['PlainMonthDay']>,
      toDriver: (val: InstanceType<T['PlainMonthDay']> | SQL) =>
        val instanceof SQL ? val : val.toString({ ...options }),
    }),
    constraints: (column, name = `check_${column.name}_month_day_format`) => [
      check(
        name,
        sql`(${column})::text ~ '^((0[1-9])|(1([0-2])))-((0[1-9])|([1-2][0-9])|(3[0-1]))$'`,
      ),
    ],
  }
}
