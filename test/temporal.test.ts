import { sql } from 'drizzle-orm'
import { pgTable, serial } from 'drizzle-orm/pg-core'
import type { PgliteDatabase } from 'drizzle-orm/pglite'
import { Temporal } from 'temporal-polyfill'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  _registerZonedDateTimeJSONFix,
  date,
  interval,
  monthDay,
  time,
  timestamp,
  timestampz,
  yearMonth,
} from '../src/temporal/index.ts'
import { createDatabase, executeQuery } from './utils.ts'

// Test table with all temporal column types
const temporalTable = pgTable(
  'temporal_test',
  {
    id: serial('id').primaryKey(),
    plainDate: date.column('plain_date'),
    plainTime: time.column('plain_time'),
    plainTimeWithPrecision: time.column('plain_time_precision', {
      precision: 3,
    }),
    plainDateTime: timestamp.column('plain_datetime'),
    plainDateTimeWithPrecision: timestamp.column('plain_datetime_precision', {
      precision: 6,
    }),
    zonedDateTime: timestampz.column('zoned_datetime'),
    zonedDateTimeWithPrecision: timestampz.column('zoned_datetime_precision', {
      precision: 3,
    }),
    duration: interval.column('duration'),
    durationWithFields: interval.column('duration_fields', {
      fields: 'hour to minute',
    }),
    durationWithPrecision: interval.column('duration_precision', {
      precision: 2,
    }),
    yearMonthValue: yearMonth.column('year_month'),
    monthDayValue: monthDay.column('month_day'),
  },
  (table) => ({
    // Add check constraints for yearMonth and monthDay
    ...yearMonth.constraints(table.yearMonthValue),
    ...monthDay.constraints(table.monthDayValue),
  }),
)

let db: PgliteDatabase

beforeAll(async () => {
  db = await createDatabase()

  // Note: We need to set intervalstyle for Duration parsing to work correctly
  await db.execute(sql`SET intervalstyle = 'iso_8601'`)

  // Create the test table using the Drizzle schema
  // We need to manually create it since PGlite doesn't support migrations
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS temporal_test (
      id SERIAL PRIMARY KEY,
      plain_date DATE,
      plain_time TIME,
      plain_time_precision TIME(3),
      plain_datetime TIMESTAMP,
      plain_datetime_precision TIMESTAMP(6),
      zoned_datetime TIMESTAMP WITH TIME ZONE,
      zoned_datetime_precision TIMESTAMP(3) WITH TIME ZONE,
      duration INTERVAL,
      duration_fields INTERVAL HOUR TO MINUTE,
      duration_precision INTERVAL(2),
      year_month TEXT,
      month_day TEXT,
      CONSTRAINT check_year_month_year_month_format CHECK ((year_month)::text ~ '^\\d{4}-((0[1-9])|(1([0-2])))$'),
      CONSTRAINT check_month_day_month_day_format CHECK ((month_day)::text ~ '^((0[1-9])|(1([0-2])))-((0[1-9])|([1-2][0-9])|(3[0-1]))$')
    )
  `)
})

describe('Temporal Column Types', () => {
  describe('date column', () => {
    it('should handle PlainDate values correctly', async () => {
      const testDate = Temporal.PlainDate.from('2023-07-25')

      // Clear any existing data first
      await db.delete(temporalTable)

      await db.insert(temporalTable).values({
        plainDate: testDate,
      })

      const result = await db
        .select({ plainDate: temporalTable.plainDate })
        .from(temporalTable)
        .limit(1)

      expect(result[0]?.plainDate).toBeInstanceOf(Temporal.PlainDate)
      expect(result[0]?.plainDate?.toString()).toBe('2023-07-25')
    })

    it('should work with SQL expressions', async () => {
      const currentDate = await executeQuery(db, sql`CURRENT_DATE::date`)

      expect(typeof currentDate).toBe('string')
      expect(currentDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })
  })

  describe('time column', () => {
    it('should handle PlainTime values correctly', async () => {
      const testTime = Temporal.PlainTime.from('14:30:45.123')

      // Clear any existing data first
      await db.delete(temporalTable)

      await db.insert(temporalTable).values({
        plainTime: testTime,
        plainTimeWithPrecision: testTime,
      })

      const result = await db
        .select({
          plainTime: temporalTable.plainTime,
          plainTimeWithPrecision: temporalTable.plainTimeWithPrecision,
        })
        .from(temporalTable)
        .limit(1)

      expect(result[0]?.plainTime).toBeInstanceOf(Temporal.PlainTime)
      expect(result[0]?.plainTimeWithPrecision).toBeInstanceOf(
        Temporal.PlainTime,
      )

      // Time without precision should truncate microseconds but may keep some precision
      expect(result[0]?.plainTime?.toString()).toMatch(/^14:30:45(\.\d+)?$/)
      // Time with precision(3) should keep milliseconds
      expect(result[0]?.plainTimeWithPrecision?.toString()).toBe('14:30:45.123')
    })
  })

  describe('timestamp column', () => {
    it('should handle PlainDateTime values correctly', async () => {
      const testDateTime = Temporal.PlainDateTime.from(
        '2023-07-25T14:30:45.123456',
      )

      // Clear any existing data first
      await db.delete(temporalTable)

      await db.insert(temporalTable).values({
        plainDateTime: testDateTime,
        plainDateTimeWithPrecision: testDateTime,
      })

      const result = await db
        .select({
          plainDateTime: temporalTable.plainDateTime,
          plainDateTimeWithPrecision: temporalTable.plainDateTimeWithPrecision,
        })
        .from(temporalTable)
        .limit(1)

      expect(result[0]?.plainDateTime).toBeInstanceOf(Temporal.PlainDateTime)
      expect(result[0]?.plainDateTimeWithPrecision).toBeInstanceOf(
        Temporal.PlainDateTime,
      )

      // Timestamp without precision should truncate microseconds but may keep some precision
      expect(result[0]?.plainDateTime?.toString()).toMatch(
        /^2023-07-25T14:30:45(\.\d+)?$/,
      )
      // Timestamp with precision(6) should keep microseconds
      expect(result[0]?.plainDateTimeWithPrecision?.toString()).toBe(
        '2023-07-25T14:30:45.123456',
      )
    })
  })

  describe('timestampz column', () => {
    it('should handle ZonedDateTime values correctly', async () => {
      const testZonedDateTime = Temporal.ZonedDateTime.from(
        '2023-07-25T14:30:45.123[America/New_York]',
      )

      // Clear any existing data first
      await db.delete(temporalTable)

      await db.insert(temporalTable).values({
        zonedDateTime: testZonedDateTime,
        zonedDateTimeWithPrecision: testZonedDateTime,
      })

      const result = await db
        .select({
          zonedDateTime: temporalTable.zonedDateTime,
          zonedDateTimeWithPrecision: temporalTable.zonedDateTimeWithPrecision,
        })
        .from(temporalTable)
        .limit(1)

      expect(result[0]?.zonedDateTime).toBeInstanceOf(Temporal.ZonedDateTime)
      expect(result[0]?.zonedDateTimeWithPrecision).toBeInstanceOf(
        Temporal.ZonedDateTime,
      )

      // Both should be in UTC timezone
      expect(result[0]?.zonedDateTime?.timeZoneId).toBe('UTC')
      expect(result[0]?.zonedDateTimeWithPrecision?.timeZoneId).toBe('UTC')

      // Check that the instant is preserved (converted to UTC)
      const originalInstant = testZonedDateTime.toInstant()
      expect(
        result[0]?.zonedDateTime?.toInstant().equals(originalInstant),
      ).toBe(true)
    })

    it('should work with ZonedDateTime JSON fix', () => {
      _registerZonedDateTimeJSONFix()

      const zdt = Temporal.ZonedDateTime.from(
        '2023-07-25T10:00:00[America/New_York]',
      )
      const jsonString = JSON.stringify(zdt)

      // Should not include timezone name
      expect(jsonString).not.toMatch(/\[America\/New_York\]/)
      expect(jsonString).toMatch(
        /^"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}"$/,
      )
    })
  })

  describe('interval column', () => {
    it('should handle Duration values correctly', async () => {
      const testDuration = Temporal.Duration.from('PT2H30M15S') // Simplified to avoid fractional seconds
      const hourMinuteDuration = Temporal.Duration.from('PT1H45M')

      // Clear any existing data first
      await db.delete(temporalTable)

      await db.insert(temporalTable).values({
        duration: testDuration,
        durationWithFields: hourMinuteDuration,
        durationWithPrecision: testDuration,
      })

      const result = await db
        .select({
          duration: temporalTable.duration,
          durationWithFields: temporalTable.durationWithFields,
          durationWithPrecision: temporalTable.durationWithPrecision,
        })
        .from(temporalTable)
        .limit(1)

      expect(result[0]?.duration).toBeInstanceOf(Temporal.Duration)
      expect(result[0]?.durationWithFields).toBeInstanceOf(Temporal.Duration)
      expect(result[0]?.durationWithPrecision).toBeInstanceOf(Temporal.Duration)

      // Duration should preserve the values
      expect(result[0]?.duration?.hours).toBe(2)
      expect(result[0]?.duration?.minutes).toBe(30)
      expect(result[0]?.duration?.seconds).toBe(15)

      // Hour to minute duration should only have hours and minutes
      expect(result[0]?.durationWithFields?.hours).toBe(1)
      expect(result[0]?.durationWithFields?.minutes).toBe(45)
    })
  })

  describe('yearMonth column', () => {
    it('should handle PlainYearMonth values correctly', async () => {
      const testYearMonth = Temporal.PlainYearMonth.from('2023-07')

      // Clear any existing data first
      await db.delete(temporalTable)

      await db.insert(temporalTable).values({
        yearMonthValue: testYearMonth,
      })

      const result = await db
        .select({ yearMonthValue: temporalTable.yearMonthValue })
        .from(temporalTable)
        .limit(1)

      expect(result[0]?.yearMonthValue).toBeInstanceOf(Temporal.PlainYearMonth)
      expect(result[0]?.yearMonthValue?.toString()).toBe('2023-07')
    })

    it('should enforce format constraints', async () => {
      // Test that invalid formats are rejected by the check constraint
      await expect(
        db.execute(
          sql`INSERT INTO temporal_test (year_month) VALUES ('invalid')`,
        ),
      ).rejects.toThrow()

      await expect(
        db.execute(
          sql`INSERT INTO temporal_test (year_month) VALUES ('2023-13')`,
        ),
      ).rejects.toThrow()
    })
  })

  describe('monthDay column', () => {
    it('should handle PlainMonthDay values correctly', async () => {
      const testMonthDay = Temporal.PlainMonthDay.from('07-25')

      // Clear any existing data first
      await db.delete(temporalTable)

      await db.insert(temporalTable).values({
        monthDayValue: testMonthDay,
      })

      const result = await db
        .select({ monthDayValue: temporalTable.monthDayValue })
        .from(temporalTable)
        .limit(1)

      expect(result[0]?.monthDayValue).toBeInstanceOf(Temporal.PlainMonthDay)
      expect(result[0]?.monthDayValue?.toString()).toBe('07-25')
    })

    it('should enforce format constraints', async () => {
      // Test that invalid formats are rejected by the check constraint
      await expect(
        db.execute(
          sql`INSERT INTO temporal_test (month_day) VALUES ('invalid')`,
        ),
      ).rejects.toThrow()

      await expect(
        db.execute(sql`INSERT INTO temporal_test (month_day) VALUES ('13-01')`),
      ).rejects.toThrow()

      await expect(
        db.execute(sql`INSERT INTO temporal_test (month_day) VALUES ('02-32')`),
      ).rejects.toThrow()
    })
  })
})

describe('Integration Tests', () => {
  it('should work with complex queries and all temporal types', async () => {
    // Clear any existing data first
    await db.delete(temporalTable)

    // Insert a complete record with all temporal types
    const testData = {
      plainDate: Temporal.PlainDate.from('2023-07-25'),
      plainTime: Temporal.PlainTime.from('14:30:45'),
      plainTimeWithPrecision: Temporal.PlainTime.from('14:30:45.123'),
      plainDateTime: Temporal.PlainDateTime.from('2023-07-25T14:30:45'),
      plainDateTimeWithPrecision: Temporal.PlainDateTime.from(
        '2023-07-25T14:30:45.123456',
      ),
      zonedDateTime: Temporal.ZonedDateTime.from(
        '2023-07-25T14:30:45[America/New_York]',
      ),
      zonedDateTimeWithPrecision: Temporal.ZonedDateTime.from(
        '2023-07-25T14:30:45.123[Europe/London]',
      ),
      duration: Temporal.Duration.from('PT2H30M'),
      durationWithFields: Temporal.Duration.from('PT1H45M'),
      durationWithPrecision: Temporal.Duration.from('PT2H30M15S'), // Simplified duration
      yearMonthValue: Temporal.PlainYearMonth.from('2023-07'),
      monthDayValue: Temporal.PlainMonthDay.from('07-25'),
    }

    const insertResult = await db
      .insert(temporalTable)
      .values(testData)
      .returning()
    expect(insertResult).toHaveLength(1)

    // Query the inserted data
    const selectResult = await db
      .select()
      .from(temporalTable)
      .where(sql`${temporalTable.id} = ${insertResult[0]!.id}`)

    expect(selectResult).toHaveLength(1)
    const record = selectResult[0]!

    // Verify all temporal types are correctly roundtripped
    expect(record.plainDate).toBeInstanceOf(Temporal.PlainDate)
    expect(record.plainDate?.toString()).toBe('2023-07-25')

    expect(record.plainTime).toBeInstanceOf(Temporal.PlainTime)
    expect(record.plainTime?.toString()).toBe('14:30:45')

    expect(record.plainDateTime).toBeInstanceOf(Temporal.PlainDateTime)
    expect(record.plainDateTime?.toString()).toBe('2023-07-25T14:30:45')

    expect(record.zonedDateTime).toBeInstanceOf(Temporal.ZonedDateTime)
    expect(record.zonedDateTime?.timeZoneId).toBe('UTC')

    expect(record.duration).toBeInstanceOf(Temporal.Duration)
    expect(record.duration?.hours).toBe(2)
    expect(record.duration?.minutes).toBe(30)

    expect(record.yearMonthValue).toBeInstanceOf(Temporal.PlainYearMonth)
    expect(record.yearMonthValue?.toString()).toBe('2023-07')

    expect(record.monthDayValue).toBeInstanceOf(Temporal.PlainMonthDay)
    expect(record.monthDayValue?.toString()).toBe('07-25')
  })

  it('should work with SQL expressions and temporal functions', async () => {
    // Test using SQL expressions with temporal columns
    const currentTimestamp = await executeQuery(
      db,
      sql`NOW()::timestamp with time zone`,
    )

    expect(typeof currentTimestamp).toBe('string')
    expect(currentTimestamp).toMatch(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/)

    // Test interval arithmetic
    const futureDate = await executeQuery(
      db,
      sql`(CURRENT_DATE + INTERVAL '1 day')::date`,
    )

    expect(typeof futureDate).toBe('string')
    expect(futureDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('should handle null values correctly', async () => {
    // Clear any existing data first
    await db.delete(temporalTable)

    // Insert record with null temporal values
    const insertResult = await db.insert(temporalTable).values({}).returning()
    expect(insertResult).toHaveLength(1)

    const selectResult = await db
      .select()
      .from(temporalTable)
      .where(sql`${temporalTable.id} = ${insertResult[0]!.id}`)

    expect(selectResult).toHaveLength(1)
    const record = selectResult[0]!

    // All temporal columns should be null
    expect(record.plainDate).toBe(null)
    expect(record.plainTime).toBe(null)
    expect(record.plainDateTime).toBe(null)
    expect(record.zonedDateTime).toBe(null)
    expect(record.duration).toBe(null)
    expect(record.yearMonthValue).toBe(null)
    expect(record.monthDayValue).toBe(null)
  })

  it('should work with date/time comparisons and filtering', async () => {
    // Insert test data with different dates
    const testDate1 = Temporal.PlainDate.from('2023-01-01')
    const testDate2 = Temporal.PlainDate.from('2023-12-31')

    await db.insert(temporalTable).values({ plainDate: testDate1 })
    await db.insert(temporalTable).values({ plainDate: testDate2 })

    // Query for dates in a specific range
    const results = await db
      .select({ plainDate: temporalTable.plainDate })
      .from(temporalTable)
      .where(sql`${temporalTable.plainDate} >= '2023-06-01'::date`)

    expect(results.length).toBeGreaterThan(0)
    results.forEach((result) => {
      if (result.plainDate) {
        expect(result.plainDate.toString() >= '2023-06-01').toBe(true)
      }
    })
  })
})
