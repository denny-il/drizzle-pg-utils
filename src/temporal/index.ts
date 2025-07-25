import {
  type ColumnBaseConfig,
  type ColumnDataType,
  SQL,
  sql,
} from 'drizzle-orm'
import {
  type CheckBuilder,
  check,
  customType,
  type ExtraConfigColumn,
  type IntervalConfig,
  type Precision,
} from 'drizzle-orm/pg-core'
import { Temporal } from 'temporal-polyfill'

/**
 * Configuration options for time-based columns.
 */
type TimeConfig = {
  /** The precision (number of fractional digits) for time values. */
  precision?: Precision
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
 * import { _registerZonedDateTimeJSONFix } from 'drizzle-pg-utils/temporal'
 *
 * // Call once at application startup
 * _registerZonedDateTimeJSONFix()
 *
 * const zdt = Temporal.ZonedDateTime.from('2023-07-25T10:00:00[America/New_York]')
 * JSON.stringify(zdt) // "2023-07-25T10:00:00-04:00" instead of "2023-07-25T10:00:00-04:00[America/New_York]"
 * ```
 *
 * @warning This modifies the global Temporal.ZonedDateTime prototype and affects all instances.
 */
export function _registerZonedDateTimeJSONFix() {
  // FIXME: IDK how to make toJSON not to output name of the timezone
  Temporal.ZonedDateTime.prototype.toJSON = function (
    this: Temporal.ZonedDateTime,
  ) {
    return this.toString({ timeZoneName: 'never', offset: 'auto' })
  }
}

/**
 * PostgreSQL timestamp column type for Temporal.PlainDateTime values.
 * Represents a date and time without timezone information.
 *
 * @example
 * ```typescript
 * import { timestamp } from 'drizzle-pg-utils/temporal'
 * import { pgTable, serial } from 'drizzle-orm/pg-core'
 *
 * const events = pgTable('events', {
 *   id: serial('id').primaryKey(),
 *   createdAt: timestamp.column('created_at'),
 *   scheduledAt: timestamp.column('scheduled_at', { precision: 3 }),
 * })
 *
 * // Usage with Temporal
 * const now = Temporal.PlainDateTime.from('2023-07-25T10:30:00')
 * await db.insert(events).values({ scheduledAt: now })
 * ```
 */
export const timestamp = {
  column: customType<{
    data: Temporal.PlainDateTime
    driverData: string
    config?: TimeConfig
  }>({
    dataType: (config) =>
      `timestamp${typeof config?.precision !== 'undefined' ? ` (${config.precision})` : ''}`,
    fromDriver: (val) => Temporal.PlainDateTime.from(val),
    toDriver: (val) =>
      val instanceof SQL ? val : val.toString({ calendarName: 'never' }),
  }),
}

/**
 * PostgreSQL timestamptz (timestamp with time zone) column type for Temporal.ZonedDateTime values.
 * Stores timestamps with timezone information and converts them to UTC in the database.
 *
 * @example
 * ```typescript
 * import { timestampz } from 'drizzle-pg-utils/temporal'
 * import { pgTable, serial } from 'drizzle-orm/pg-core'
 *
 * const sessions = pgTable('sessions', {
 *   id: serial('id').primaryKey(),
 *   loginAt: timestampz.column('login_at'),
 *   expiresAt: timestampz.column('expires_at', { precision: 6 }),
 * })
 *
 * // Usage with Temporal
 * const loginTime = Temporal.ZonedDateTime.from('2023-07-25T10:30:00[America/New_York]')
 * await db.insert(sessions).values({ loginAt: loginTime })
 * ```
 *
 * @note Values are automatically converted to UTC when stored and returned as UTC ZonedDateTime instances.
 */
export const timestampz = {
  column: customType<{
    data: Temporal.ZonedDateTime
    driverData: string
    config?: TimeConfig
  }>({
    dataType: (config) =>
      `timestamp${typeof config?.precision !== 'undefined' ? ` (${config.precision})` : ''} with time zone`,
    fromDriver: (val) => Temporal.Instant.from(val).toZonedDateTimeISO('UTC'),
    toDriver: (val) =>
      val instanceof SQL
        ? val
        : val.toString({ timeZoneName: 'never', offset: 'auto' }),
  }),
}

/**
 * PostgreSQL date column type for Temporal.PlainDate values.
 * Represents a calendar date without time or timezone information.
 *
 * @example
 * ```typescript
 * import { date } from 'drizzle-pg-utils/temporal'
 * import { pgTable, serial } from 'drizzle-orm/pg-core'
 *
 * const users = pgTable('users', {
 *   id: serial('id').primaryKey(),
 *   birthDate: date.column('birth_date'),
 *   joinDate: date.column('join_date'),
 * })
 *
 * // Usage with Temporal
 * const birthDate = Temporal.PlainDate.from('1990-05-15')
 * await db.insert(users).values({ birthDate })
 * ```
 */
export const date = {
  column: customType<{
    data: Temporal.PlainDate
    driverData: string
  }>({
    dataType: () => 'date',
    fromDriver: (val) => Temporal.PlainDate.from(val),
    toDriver: (val) => (val instanceof SQL ? val : val.toString()),
  }),
}

/**
 * PostgreSQL time column type for Temporal.PlainTime values.
 * Represents a time of day without date or timezone information.
 *
 * @example
 * ```typescript
 * import { time } from 'drizzle-pg-utils/temporal'
 * import { pgTable, serial } from 'drizzle-orm/pg-core'
 *
 * const schedules = pgTable('schedules', {
 *   id: serial('id').primaryKey(),
 *   startTime: time.column('start_time'),
 *   endTime: time.column('end_time', { precision: 3 }),
 * })
 *
 * // Usage with Temporal
 * const startTime = Temporal.PlainTime.from('09:00:00')
 * const endTime = Temporal.PlainTime.from('17:30:00.123')
 * await db.insert(schedules).values({ startTime, endTime })
 * ```
 */
export const time = {
  column: customType<{
    data: Temporal.PlainTime
    driverData: string
    config?: TimeConfig
  }>({
    dataType: (config) =>
      `time${typeof config?.precision !== 'undefined' ? ` (${config.precision})` : ''}`,
    fromDriver: (val) => Temporal.PlainTime.from(val),
    toDriver: (val) => (val instanceof SQL ? val : val.toString()),
  }),
}

/**
 * PostgreSQL interval column type for Temporal.Duration values.
 * Represents a time span or duration between two points in time.
 *
 * @example
 * ```typescript
 * import { interval } from 'drizzle-pg-utils/temporal'
 * import { pgTable, serial } from 'drizzle-orm/pg-core'
 *
 * const tasks = pgTable('tasks', {
 *   id: serial('id').primaryKey(),
 *   duration: interval.column('duration'),
 *   timeout: interval.column('timeout', { fields: 'HOUR TO MINUTE', precision: 2 }),
 * })
 *
 * // Usage with Temporal
 * const duration = Temporal.Duration.from('PT2H30M') // 2 hours 30 minutes
 * const timeout = Temporal.Duration.from('PT1H15M30S') // 1 hour 15 minutes 30 seconds
 * await db.insert(tasks).values({ duration, timeout })
 * ```
 *
 * @requires PostgreSQL intervalstyle set to 'iso_8601'
 * @see https://www.postgresql.org/docs/current/datatype-datetime.html#DATATYPE-INTERVAL-OUTPUT
 */
export const interval = {
  column: customType<{
    data: Temporal.Duration
    driverData: string
    config?: IntervalConfig
  }>({
    dataType: (config) =>
      `interval${config?.fields ? ` ${config.fields}` : ''}${typeof config?.precision !== 'undefined' ? ` (${config.precision})` : ''}`,
    fromDriver: (val) => Temporal.Duration.from(val),
    toDriver: (val) => (val instanceof SQL ? val : val.toString()),
  }),
}

/**
 * PostgreSQL text column type with check constraints for Temporal.PlainYearMonth values.
 * Represents a year-month combination (e.g., "2023-07") stored as text with format validation.
 *
 * @example
 * ```typescript
 * import { yearMonth } from 'drizzle-pg-utils/temporal'
 * import { pgTable, serial } from 'drizzle-orm/pg-core'
 *
 * const reports = pgTable('reports', {
 *   id: serial('id').primaryKey(),
 *   reportMonth: yearMonth.column('report_month'),
 * }, (table) => ({
 *   // Add the check constraint
 *   ...yearMonth.constraints(table.reportMonth),
 * }))
 *
 * // Usage with Temporal
 * const month = Temporal.PlainYearMonth.from('2023-07')
 * await db.insert(reports).values({ reportMonth: month })
 * ```
 *
 * @note The constraints method returns check constraints that validate the YYYY-MM format.
 */
export const yearMonth = {
  /**
   * Creates check constraints to validate year-month format (YYYY-MM).
   *
   * @param column - The column to apply the constraint to
   * @param name - Optional custom name for the check constraint
   * @returns Array of check constraint builders
   *
   * @example
   * ```typescript
   * const table = pgTable('example', {
   *   month: yearMonth.column('month'),
   * }, (table) => ({
   *   ...yearMonth.constraints(table.month, 'custom_month_check'),
   * }))
   * ```
   */
  constraints: (
    column: ExtraConfigColumn<ColumnBaseConfig<ColumnDataType, string>>,
    name: string = `check_${column.name}_year_month_format`,
  ): CheckBuilder[] => [
    check(name, sql`(${column})::text ~ '^\\d{4}-((0[1-9])|(1([0-2])))$'`),
  ],
  column: customType<{
    data: Temporal.PlainYearMonth
    driverData: string
  }>({
    // TODO: add check in future: https://orm.drizzle.team/docs/indexes-constraints#check
    dataType: () => 'text',
    fromDriver: (val) => Temporal.PlainYearMonth.from(val),
    toDriver: (val) => (val instanceof SQL ? val : val.toString()),
  }),
}

/**
 * PostgreSQL text column type with check constraints for Temporal.PlainMonthDay values.
 * Represents a month-day combination (e.g., "07-25") stored as text with format validation.
 *
 * @example
 * ```typescript
 * import { monthDay } from 'drizzle-pg-utils/temporal'
 * import { pgTable, serial } from 'drizzle-orm/pg-core'
 *
 * const holidays = pgTable('holidays', {
 *   id: serial('id').primaryKey(),
 *   holidayDate: monthDay.column('holiday_date'),
 * }, (table) => ({
 *   // Add the check constraint
 *   ...monthDay.constraints(table.holidayDate),
 * }))
 *
 * // Usage with Temporal
 * const independenceDay = Temporal.PlainMonthDay.from('07-04')
 * await db.insert(holidays).values({ holidayDate: independenceDay })
 * ```
 *
 * @note The constraints method returns check constraints that validate the MM-DD format.
 */
export const monthDay = {
  /**
   * Creates check constraints to validate month-day format (MM-DD).
   *
   * @param column - The column to apply the constraint to
   * @param name - Optional custom name for the check constraint
   * @returns Array of check constraint builders
   *
   * @example
   * ```typescript
   * const table = pgTable('example', {
   *   anniversary: monthDay.column('anniversary'),
   * }, (table) => ({
   *   ...monthDay.constraints(table.anniversary, 'custom_monthday_check'),
   * }))
   * ```
   */
  constraints: (
    column: ExtraConfigColumn<ColumnBaseConfig<ColumnDataType, string>>,
    name: string = `check_${column.name}_month_day_format`,
  ): CheckBuilder[] => [
    check(
      name,
      sql`(${column})::text ~ '^((0[1-9])|(1([0-2])))-((0[1-9])|([1-2][0-9])|(3[0-1]))$'`,
    ),
  ],
  column: customType<{
    data: Temporal.PlainMonthDay
    driverData: string
  }>({
    // TODO: add check in future: https://orm.drizzle.team/docs/indexes-constraints#check
    dataType: () => 'text',
    fromDriver: (val) => Temporal.PlainMonthDay.from(val),
    toDriver: (val) => (val instanceof SQL ? val : val.toString()),
  }),
}

/**
 * Default export containing all temporal column types for convenience.
 *
 * @example
 * ```typescript
 * import temporal from 'drizzle-pg-utils/temporal'
 *
 * const events = pgTable('events', {
 *   id: serial('id').primaryKey(),
 *   eventDate: temporal.date.column('event_date'),
 *   eventTime: temporal.time.column('event_time'),
 *   createdAt: temporal.timestampz.column('created_at'),
 * })
 * ```
 */
export default {
  timestamp,
  timestampz,
  date,
  time,
  interval,
  yearMonth,
  monthDay,
}
