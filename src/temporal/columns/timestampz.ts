import { SQL } from 'drizzle-orm'
import { customType } from 'drizzle-orm/pg-core'

import type { TemporalColumn } from '../types.ts'
import type { TimeConfig } from './timestamp.ts'

type Config<T extends typeof globalThis.Temporal> = {
  data: InstanceType<T['ZonedDateTime']>
  driverData: string
  config?: TimeConfig
}

export type TemporalTimestampzType<T extends typeof globalThis.Temporal> =
  TemporalColumn<{
    config: Config<T>
    constraints: false
  }>

/**
 * Creates a PostgreSQL timestamptz (timestamp with time zone) column type for Temporal.ZonedDateTime values.
 * Stores timestamps with timezone information and converts them to UTC in the database.
 *
 * @param Temporal - The Temporal implementation to use
 * @returns Column factory function
 */
export function createTimestampz<T extends typeof globalThis.Temporal>(
  Temporal: T,
  options?: globalThis.Temporal.ZonedDateTimeToStringOptions,
): TemporalTimestampzType<T> {
  return {
    column: customType<Config<T>>({
      dataType: (config?: TimeConfig) =>
        `timestamp${typeof config?.precision !== 'undefined' ? ` (${config.precision})` : ''} with time zone`,
      fromDriver: (val: string) =>
        Temporal.Instant.from(val).toZonedDateTimeISO('UTC') as InstanceType<
          T['ZonedDateTime']
        >,
      toDriver: (val: InstanceType<T['ZonedDateTime']> | SQL) =>
        val instanceof SQL
          ? val
          : val.toString({
              timeZoneName: 'never',
              offset: 'auto',
              ...options,
            }),
    }),
  }
}

/**
 * Register a fix for Temporal.ZonedDateTime.toJSON to avoid adding the timezone name in the end, like:
 * ```JSON
 * "1995-12-07T03:24:30.0000035-08:00[America/Los_Angeles]"
 * ```
 *
 * This is a destructive operation and overrides
 * ```JS
 * ZonedDateTime.prototype.toJSON
 * ```
 * with
 * ```JS
 * return this.toString({ calendarName: 'never', timeZoneName: 'never', offset: 'auto' })
 * ```
 *
 * @example
 * ```typescript
 * import { Temporal } from 'temporal-polyfill'
 * import { _registerZonedDateTimeJSONFix } from '@denny-il/drizzle-pg-utils/temporal'
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
export function _registerZonedDateTimeJSONFix(
  Temporal: typeof globalThis.Temporal = globalThis.Temporal,
) {
  // FIXME: IDK how to make toJSON not to output name of the timezone; different runtimes may work differently too, so leave it to the user to decide whether they want this or not
  Temporal.ZonedDateTime.prototype.toJSON = function (
    this: Temporal.ZonedDateTime,
  ) {
    return this.toString({
      calendarName: 'never',
      timeZoneName: 'never',
      offset: 'auto',
    })
  }
}
