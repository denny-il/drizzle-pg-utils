import { SQL, sql } from 'drizzle-orm'
import { check, customType } from 'drizzle-orm/pg-core'

import type { TemporalColumn } from '../types.ts'

type Config<T extends typeof globalThis.Temporal> = {
  data: InstanceType<T['PlainYearMonth']>
  driverData: string
}

export type TemporalYearMonthType<T extends typeof globalThis.Temporal> =
  TemporalColumn<{
    config: Config<T>
    constraints: true
  }>

/**
 * Creates a PostgreSQL text column type for Temporal.PlainYearMonth values.
 * Represents a year-month combination (e.g., "2023-07") stored as text.
 *
 * @param Temporal - The Temporal implementation to use
 * @returns Column factory function
 */
export function createYearMonth<T extends typeof globalThis.Temporal>(
  Temporal: T,
  options?: globalThis.Temporal.PlainDateToStringOptions,
): TemporalYearMonthType<T> {
  return {
    column: customType<Config<T>>({
      dataType: () => 'text',
      fromDriver: (val: string) =>
        Temporal.PlainYearMonth.from(val) as InstanceType<T['PlainYearMonth']>,
      toDriver: (val: InstanceType<T['PlainYearMonth']> | SQL) =>
        val instanceof SQL ? val : val.toString({ ...options }),
    }),
    constraints: (column, name = `check_${column.name}_year_month_format`) => [
      check(
        name,
        sql`(${column})::text ~ '^(\\d{4}|[+]\\d{6}|-\\d{6})-((0[1-9])|(1([0-2])))$'
          AND (${column})::text !~ '^-000000-'
          AND (
            (${column})::text ~ '^\\d{4}-'
            OR (
              substring((${column})::text from 1 for 7)::integer > -271821
              AND substring((${column})::text from 1 for 7)::integer < 275760
            )
            OR (
              substring((${column})::text from 1 for 7)::integer = -271821
              AND substring((${column})::text from 9 for 2)::integer >= 4
            )
            OR (
              substring((${column})::text from 1 for 7)::integer = 275760
              AND substring((${column})::text from 9 for 2)::integer <= 9
            )
          )`,
      ),
    ],
  }
}
