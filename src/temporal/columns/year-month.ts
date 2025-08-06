import { SQL, sql } from 'drizzle-orm'
import { check, customType } from 'drizzle-orm/pg-core'
import type { Temporal } from 'temporal-spec'
import type { TemporalColumn } from '../types.ts'

type Config = {
  data: Temporal.PlainYearMonth
  driverData: string
}

export type TemporalYearMonthType = TemporalColumn<{
  config: Config
  constraints: true
}>

/**
 * Creates a PostgreSQL text column type for Temporal.PlainYearMonth values.
 * Represents a year-month combination (e.g., "2023-07") stored as text.
 *
 * @param Temporal - The Temporal implementation to use
 * @returns Column factory function
 */
export function createYearMonth(
  Temporal: typeof import('temporal-spec').Temporal,
): TemporalYearMonthType {
  return {
    column: customType<Config>({
      dataType: () => 'text',
      fromDriver: (val: string) => Temporal.PlainYearMonth.from(val),
      toDriver: (val: Temporal.PlainYearMonth | SQL) =>
        val instanceof SQL ? val : val.toString(),
    }),
    constraints: (column, name = `check_${column.name}_year_month_format`) => [
      check(name, sql`(${column})::text ~ '^\\d{4}-((0[1-9])|(1([0-2])))$'`),
    ],
  }
}
