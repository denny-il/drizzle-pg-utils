import { SQL } from 'drizzle-orm'
import { customType } from 'drizzle-orm/pg-core'
import type { Temporal } from 'temporal-spec'
import type { TemporalColumn } from '../types.ts'
import type { TimeConfig } from './timestamp.ts'

type Config = {
  data: Temporal.ZonedDateTime
  driverData: string
  config?: TimeConfig
}

export type TemporalTimestampzType = TemporalColumn<{
  config: Config
  constraints: false
}>

/**
 * Creates a PostgreSQL timestamptz (timestamp with time zone) column type for Temporal.ZonedDateTime values.
 * Stores timestamps with timezone information and converts them to UTC in the database.
 *
 * @param Temporal - The Temporal implementation to use
 * @returns Column factory function
 */
export function createTimestampz(
  Temporal: typeof import('temporal-spec').Temporal,
): TemporalTimestampzType {
  return {
    column: customType<Config>({
      dataType: (config?: TimeConfig) =>
        `timestamp${typeof config?.precision !== 'undefined' ? ` (${config.precision})` : ''} with time zone`,
      fromDriver: (val: string) =>
        Temporal.Instant.from(val).toZonedDateTimeISO('UTC'),
      toDriver: (val: Temporal.ZonedDateTime | SQL) =>
        val instanceof SQL
          ? val
          : val.toString({ timeZoneName: 'never', offset: 'auto' }),
    }),
  }
}

/**
 * Register a fix for Temporal.ZonedDateTime.toJSON to avoid outputting the timezone name in the end, like:
 * ```JSON
 * "1995-12-07T03:24:30.0000035-08:00[America/Los_Angeles]"
 * ```
 *
 * This is destructive operation and overrides
 * ```JS
 * ZonedDateTime.prototype.toJSON
 * ```
 * with
 * ```JS
 * return this.toString({ timeZoneName: 'never', offset: 'auto' })
 * ```
 *
 * @example
 * ```typescript
 * import { Temporal } from 'temporal-polyfill'
 * import { _registerZonedDateTimeJSONFix } from '@denny-il/drizzle-pg-utils/temporal/json-fix'
 *
 * // Call once at application startup
 * _registerZonedDateTimeJSONFix(Temporal)
 *
 * const zdt = Temporal.ZonedDateTime.from('2023-07-25T10:00:00[America/New_York]')
 * JSON.stringify(zdt) // "2023-07-25T10:00:00-04:00" instead of "2023-07-25T10:00:00-04:00[America/New_York]"
 * ```
 *
 * @warning This modifies the global Temporal.ZonedDateTime prototype and affects all instances.
 */
export function registerZonedDateTimeJSONFix(
  Temporal: typeof import('temporal-spec').Temporal,
) {
  // FIXME: IDK how to make toJSON not to output name of the timezone
  Temporal.ZonedDateTime.prototype.toJSON = function (
    this: Temporal.ZonedDateTime,
  ) {
    return this.toString({ timeZoneName: 'never', offset: 'auto' })
  }
}
