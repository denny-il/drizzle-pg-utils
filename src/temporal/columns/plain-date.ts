import { SQL } from 'drizzle-orm'
import { customType } from 'drizzle-orm/pg-core'
import type { Temporal } from 'temporal-spec'
import type { TemporalColumn } from '../types.ts'

type Config = {
  data: Temporal.PlainDate
  driverData: string
}

export type TemporalPlainDateType = TemporalColumn<{
  config: Config
  constraints: false
}>

/**
 * Creates a PostgreSQL date column type for Temporal.PlainDate values.
 * Represents a calendar date without time or timezone information.
 *
 * @param Temporal - The Temporal implementation to use
 * @returns Column factory function
 */
export function createPlainDate(
  Temporal: typeof import('temporal-spec').Temporal,
): TemporalPlainDateType {
  return {
    column: customType<Config>({
      dataType: () => 'date',
      fromDriver: (val: string) => Temporal.PlainDate.from(val),
      toDriver: (val: Temporal.PlainDate | SQL) =>
        val instanceof SQL ? val : val.toString(),
    }),
  }
}
