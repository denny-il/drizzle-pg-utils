import { SQL, sql } from 'drizzle-orm'
import { check, customType } from 'drizzle-orm/pg-core'
import type { Temporal } from 'temporal-spec'
import type { TemporalColumn } from '../types.ts'

type Config = {
  data: Temporal.PlainMonthDay
  driverData: string
}

export type TemporalMonthDayType = TemporalColumn<{
  config: Config
  constraints: true
}>

/**
 * Creates a PostgreSQL text column type for Temporal.PlainMonthDay values.
 * Represents a month-day combination (e.g., "07-25") stored as text.
 *
 * @param Temporal - The Temporal implementation to use
 * @returns Column factory function
 */
export function createMonthDay(
  Temporal: typeof import('temporal-spec').Temporal,
): TemporalMonthDayType {
  return {
    column: customType<Config>({
      dataType: () => 'text',
      fromDriver: (val: string) => Temporal.PlainMonthDay.from(val),
      toDriver: (val: Temporal.PlainMonthDay | SQL) =>
        val instanceof SQL ? val : val.toString(),
    }),
    constraints: (column, name = `check_${column.name}_month_day_format`) => [
      check(
        name,
        sql`(${column})::text ~ '^((0[1-9])|(1([0-2])))-((0[1-9])|([1-2][0-9])|(3[0-1]))$'`,
      ),
    ],
  }
}
