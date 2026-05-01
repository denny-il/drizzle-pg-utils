import { gte, sql } from 'drizzle-orm'
import { pgTable, serial } from 'drizzle-orm/pg-core'
import type { PgliteDatabase } from 'drizzle-orm/pglite'
import { Temporal, Temporal as TemporalImpl } from 'temporal-polyfill'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  interval,
  monthDay,
  plainDate,
  time,
  timestamp,
  timestampz,
  yearMonth,
} from '../../src/temporal/polyfill.ts'
import { createDatabase, executeQuery } from '../utils.ts'

// Test table with all temporal column types
const temporalTable = pgTable(
  'temporal_test',
  {
    id: serial('id').primaryKey(),
    plainDate: plainDate.column('plain_date'),
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
      CONSTRAINT check_year_month_year_month_format CHECK ((year_month)::text ~ '^(\\d{4}|[+]\\d{6}|-\\d{6})-((0[1-9])|(1([0-2])))$'
        AND (year_month)::text !~ '^-000000-'
        AND (
          (year_month)::text ~ '^\\d{4}-'
          OR (
            substring((year_month)::text from 1 for 7)::integer > -271821
            AND substring((year_month)::text from 1 for 7)::integer < 275760
          )
          OR (
            substring((year_month)::text from 1 for 7)::integer = -271821
            AND substring((year_month)::text from 9 for 2)::integer >= 4
          )
          OR (
            substring((year_month)::text from 1 for 7)::integer = 275760
            AND substring((year_month)::text from 9 for 2)::integer <= 9
          )
        )),
      CONSTRAINT check_month_day_month_day_format CHECK ((month_day)::text ~ '^(((0[13578])|(1[02]))-((0[1-9])|([1-2][0-9])|(3[0-1]))|((0[469])|11)-((0[1-9])|([1-2][0-9])|30)|02-((0[1-9])|(1[0-9])|(2[0-9])))$')
    )
  `)

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS factory_temporal_test (
      id SERIAL PRIMARY KEY,
      plain_date DATE,
      plain_time TIME,
      plain_datetime TIMESTAMP,
      zoned_datetime TIMESTAMP(3) WITH TIME ZONE,
      duration INTERVAL(2),
      year_month TEXT,
      month_day TEXT,
      CONSTRAINT check_year_month_year_month_format CHECK ((year_month)::text ~ '^(\\d{4}|[+]\\d{6}|-\\d{6})-((0[1-9])|(1([0-2])))$'
        AND (year_month)::text !~ '^-000000-'
        AND (
          (year_month)::text ~ '^\\d{4}-'
          OR (
            substring((year_month)::text from 1 for 7)::integer > -271821
            AND substring((year_month)::text from 1 for 7)::integer < 275760
          )
          OR (
            substring((year_month)::text from 1 for 7)::integer = -271821
            AND substring((year_month)::text from 9 for 2)::integer >= 4
          )
          OR (
            substring((year_month)::text from 1 for 7)::integer = 275760
            AND substring((year_month)::text from 9 for 2)::integer <= 9
          )
        )),
      CONSTRAINT check_month_day_month_day_format CHECK ((month_day)::text ~ '^(((0[13578])|(1[02]))-((0[1-9])|([1-2][0-9])|(3[0-1]))|((0[469])|11)-((0[1-9])|([1-2][0-9])|30)|02-((0[1-9])|(1[0-9])|(2[0-9])))$')
    )
  `)
})

beforeEach(async () => {
  await db.delete(temporalTable)
})

describe('Temporal Export Tests', () => {
  it('should export temporal', async () => {
    const temporalImport = await import('@denny-il/drizzle-pg-utils/temporal')
    expect(temporalImport).toBeDefined()
    expect(temporalImport.createPlainDate).toBeDefined()
    expect(temporalImport.createTime).toBeDefined()
    expect(temporalImport.createTimestamp).toBeDefined()
    expect(temporalImport.createTimestampz).toBeDefined()
    expect(temporalImport.createInterval).toBeDefined()
    expect(temporalImport.createYearMonth).toBeDefined()
    expect(temporalImport.createMonthDay).toBeDefined()
  })
})

describe('Temporal Column Types', () => {
  describe('date column', () => {
    it('should handle PlainDate values correctly', async () => {
      const testDate = TemporalImpl.PlainDate.from('2023-07-25')

      await db.insert(temporalTable).values([
        {
          plainDate: testDate,
        },
      ])

      const [result] = await db
        .select({ plainDate: temporalTable.plainDate })
        .from(temporalTable)
        .limit(1)

      expect(result!.plainDate).toBeInstanceOf(TemporalImpl.PlainDate)
      expect(result!.plainDate!.toString()).toBe('2023-07-25')
    })

    it('should work with SQL expressions', async () => {
      const currentDate = await executeQuery(db, sql`CURRENT_DATE::date`)

      expect(typeof currentDate).toBe('string')
      expect(currentDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })
  })

  describe('time column', () => {
    it('should handle PlainTime values correctly', async () => {
      const testTime = TemporalImpl.PlainTime.from('14:30:45.123')

      await db.insert(temporalTable).values({
        plainTime: testTime,
        plainTimeWithPrecision: testTime,
      })

      const [result] = await db
        .select({
          plainTime: temporalTable.plainTime,
          plainTimeWithPrecision: temporalTable.plainTimeWithPrecision,
        })
        .from(temporalTable)
        .limit(1)

      expect(result!.plainTime).toBeInstanceOf(TemporalImpl.PlainTime)
      expect(result!.plainTimeWithPrecision).toBeInstanceOf(
        TemporalImpl.PlainTime,
      )

      // Time without precision should truncate microseconds but may keep some precision
      expect(result!.plainTime!.toString()).toMatch(/^14:30:45(\.\d+)?$/)
      // Time with precision(3) should keep milliseconds
      expect(result!.plainTimeWithPrecision!.toString()).toBe('14:30:45.123')
    })

    it('should apply configured millisecond precision', async () => {
      await db.insert(temporalTable).values({
        plainTimeWithPrecision: TemporalImpl.PlainTime.from('14:30:45.1234'),
      })

      const [result] = await db
        .select({
          plainTimeWithPrecision: temporalTable.plainTimeWithPrecision,
        })
        .from(temporalTable)
        .limit(1)

      expect(result!.plainTimeWithPrecision!.millisecond).toBe(123)
      expect(result!.plainTimeWithPrecision!.microsecond).toBe(0)
      expect(result!.plainTimeWithPrecision!.nanosecond).toBe(0)
    })
  })

  describe('timestamp column', () => {
    it('should handle PlainDateTime values correctly', async () => {
      const testDateTime = TemporalImpl.PlainDateTime.from(
        '2023-07-25T14:30:45.123456',
      )

      await db.insert(temporalTable).values({
        plainDateTime: testDateTime,
        plainDateTimeWithPrecision: testDateTime,
      })

      const [result] = await db
        .select({
          plainDateTime: temporalTable.plainDateTime,
          plainDateTimeWithPrecision: temporalTable.plainDateTimeWithPrecision,
        })
        .from(temporalTable)
        .limit(1)

      expect(result!.plainDateTime).toBeInstanceOf(TemporalImpl.PlainDateTime)
      expect(result!.plainDateTimeWithPrecision).toBeInstanceOf(
        TemporalImpl.PlainDateTime,
      )

      // Timestamp without precision should truncate microseconds but may keep some precision
      expect(result!.plainDateTime!.toString()).toMatch(
        /^2023-07-25T14:30:45(\.\d+)?$/,
      )
      // Timestamp with precision(6) should keep microseconds
      expect(result!.plainDateTimeWithPrecision!.toString()).toBe(
        '2023-07-25T14:30:45.123456',
      )
    })
  })

  describe('timestampz column', () => {
    it('should handle Instant values correctly', async () => {
      const testInstant = TemporalImpl.Instant.from('2023-07-25T18:30:45.123Z')

      await db.insert(temporalTable).values({
        zonedDateTime: testInstant,
        zonedDateTimeWithPrecision: testInstant,
      })

      const [result] = await db
        .select({
          zonedDateTime: temporalTable.zonedDateTime,
          zonedDateTimeWithPrecision: temporalTable.zonedDateTimeWithPrecision,
        })
        .from(temporalTable)
        .limit(1)

      expect(result!.zonedDateTime).toBeInstanceOf(TemporalImpl.Instant)
      expect(result!.zonedDateTimeWithPrecision).toBeInstanceOf(
        TemporalImpl.Instant,
      )
      expect(result!.zonedDateTime!.equals(testInstant)).toBe(true)
      expect(result!.zonedDateTimeWithPrecision!.equals(testInstant)).toBe(true)
    })

    it('should apply configured millisecond precision', async () => {
      const testInstant = TemporalImpl.Instant.from('2023-07-25T18:30:45.1234Z')

      await db.insert(temporalTable).values({
        zonedDateTimeWithPrecision: testInstant,
      })

      const [result] = await db
        .select({
          zonedDateTimeWithPrecision: temporalTable.zonedDateTimeWithPrecision,
        })
        .from(temporalTable)
        .limit(1)

      expect(result!.zonedDateTimeWithPrecision).toBeInstanceOf(
        TemporalImpl.Instant,
      )
      expect(
        result!.zonedDateTimeWithPrecision!.equals(
          TemporalImpl.Instant.from('2023-07-25T18:30:45.123Z'),
        ),
      ).toBe(true)
    })
  })

  describe('interval column', () => {
    it('should handle Duration values correctly', async () => {
      const testDuration = TemporalImpl.Duration.from('PT2H30M15S') // Simplified to avoid fractional seconds
      const hourMinuteDuration = TemporalImpl.Duration.from('PT1H45M')

      await db.insert(temporalTable).values({
        duration: testDuration,
        durationWithFields: hourMinuteDuration,
        durationWithPrecision: testDuration,
      })

      const [result] = await db
        .select({
          duration: temporalTable.duration,
          durationWithFields: temporalTable.durationWithFields,
          durationWithPrecision: temporalTable.durationWithPrecision,
        })
        .from(temporalTable)
        .limit(1)

      expect(result!.duration).toBeInstanceOf(TemporalImpl.Duration)
      expect(result!.durationWithFields).toBeInstanceOf(TemporalImpl.Duration)
      expect(result!.durationWithPrecision).toBeInstanceOf(
        TemporalImpl.Duration,
      )

      // Duration should preserve the values
      expect(result!.duration!.hours).toBe(2)
      expect(result!.duration!.minutes).toBe(30)
      expect(result!.duration!.seconds).toBe(15)

      // Hour to minute duration should only have hours and minutes
      expect(result!.durationWithFields!.hours).toBe(1)
      expect(result!.durationWithFields!.minutes).toBe(45)
    })

    it('should apply configured fractional-second precision', async () => {
      await db.insert(temporalTable).values({
        durationWithPrecision: TemporalImpl.Duration.from('PT2H30M15.674S'),
      })

      const [result] = await db
        .select({
          durationWithPrecision: temporalTable.durationWithPrecision,
        })
        .from(temporalTable)
        .limit(1)

      expect(result!.durationWithPrecision!.seconds).toBe(15)
      expect(result!.durationWithPrecision!.milliseconds).toBe(670)
      expect(result!.durationWithPrecision!.microseconds).toBe(0)
      expect(result!.durationWithPrecision!.nanoseconds).toBe(0)
    })
  })

  describe('yearMonth column', () => {
    it('should handle PlainYearMonth values correctly', async () => {
      const testYearMonth = TemporalImpl.PlainYearMonth.from('2023-07')

      await db.insert(temporalTable).values({
        yearMonthValue: testYearMonth,
      })

      const result = await db
        .select({ yearMonthValue: temporalTable.yearMonthValue })
        .from(temporalTable)
        .limit(1)

      expect(result[0]!.yearMonthValue).toBeInstanceOf(
        TemporalImpl.PlainYearMonth,
      )
      expect(result[0]!.yearMonthValue!.toString()).toBe('2023-07')
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

    it.each([
      '0000-01',
      '0001-01',
      '9999-12',
      '+010000-01',
      '-000001-01',
      '+275760-09',
      '-271821-04',
    ])('should accept edge year-month format %s', async (value) => {
      await db.execute(
        sql`INSERT INTO temporal_test (year_month) VALUES (${value})`,
      )

      const [result] = await db
        .select({ yearMonthValue: temporalTable.yearMonthValue })
        .from(temporalTable)
        .limit(1)

      expect(result!.yearMonthValue).toBeInstanceOf(TemporalImpl.PlainYearMonth)
      expect(result!.yearMonthValue!.toString()).toBe(
        TemporalImpl.PlainYearMonth.from(value).toString(),
      )
    })

    it.each([
      '1-01',
      '001-01',
      '10000-01',
      '2023-1',
      '2023-00',
      '2023-13',
      '-000000-01',
      '+275760-10',
      '+275761-01',
      '-271821-03',
      '-271822-12',
    ])('should reject malformed year-month format %s', async (value) => {
      await expect(
        db.execute(
          sql`INSERT INTO temporal_test (year_month) VALUES (${value})`,
        ),
      ).rejects.toThrow()
    })
  })

  describe('monthDay column', () => {
    it('should handle PlainMonthDay values correctly', async () => {
      const testMonthDay = TemporalImpl.PlainMonthDay.from('07-25')

      await db.insert(temporalTable).values({
        monthDayValue: testMonthDay,
      })

      const [result] = await db
        .select({ monthDayValue: temporalTable.monthDayValue })
        .from(temporalTable)
        .limit(1)

      expect(result!.monthDayValue).toBeInstanceOf(TemporalImpl.PlainMonthDay)
      expect(result!.monthDayValue!.toString()).toBe('07-25')
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

    it.each([
      '01-01',
      '02-29',
      '04-30',
      '12-31',
    ])('should accept edge month-day format %s', async (value) => {
      await db.execute(
        sql`INSERT INTO temporal_test (month_day) VALUES (${value})`,
      )

      const [result] = await db
        .select({ monthDayValue: temporalTable.monthDayValue })
        .from(temporalTable)
        .limit(1)

      expect(result!.monthDayValue).toBeInstanceOf(TemporalImpl.PlainMonthDay)
      expect(result!.monthDayValue!.toString()).toBe(value)
    })

    it.each([
      '1-01',
      '01-1',
      '00-01',
      '01-00',
      '13-01',
      '12-32',
      '02-30',
      '02-31',
      '04-31',
      '06-31',
      '09-31',
      '11-31',
    ])('should reject malformed month-day format %s', async (value) => {
      await expect(
        db.execute(
          sql`INSERT INTO temporal_test (month_day) VALUES (${value})`,
        ),
      ).rejects.toThrow()
    })
  })
})

describe('Integration Tests', () => {
  it('should work with complex queries and all temporal types', async () => {
    // Insert a complete record with all temporal types
    const testData = {
      plainDate: TemporalImpl.PlainDate.from('2023-07-25'),
      plainTime: TemporalImpl.PlainTime.from('14:30:45'),
      plainTimeWithPrecision: TemporalImpl.PlainTime.from('14:30:45.123'),
      plainDateTime: TemporalImpl.PlainDateTime.from('2023-07-25T14:30:45'),
      plainDateTimeWithPrecision: TemporalImpl.PlainDateTime.from(
        '2023-07-25T14:30:45.123456',
      ),
      zonedDateTime: TemporalImpl.Instant.from('2023-07-25T18:30:45Z'),
      zonedDateTimeWithPrecision: TemporalImpl.Instant.from(
        '2023-07-25T13:30:45.123Z',
      ),
      duration: TemporalImpl.Duration.from('PT2H30M'),
      durationWithFields: TemporalImpl.Duration.from('PT1H45M'),
      durationWithPrecision: TemporalImpl.Duration.from('PT2H30M15S'), // Simplified duration
      yearMonthValue: TemporalImpl.PlainYearMonth.from('2023-07'),
      monthDayValue: TemporalImpl.PlainMonthDay.from('07-25'),
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
    expect(record.plainDate).toBeInstanceOf(TemporalImpl.PlainDate)
    expect(record.plainDate!.toString()).toBe('2023-07-25')

    expect(record.plainTime).toBeInstanceOf(TemporalImpl.PlainTime)
    expect(record.plainTime!.toString()).toBe('14:30:45')

    expect(record.plainDateTime).toBeInstanceOf(TemporalImpl.PlainDateTime)
    expect(record.plainDateTime!.toString()).toBe('2023-07-25T14:30:45')

    expect(record.zonedDateTime).toBeInstanceOf(TemporalImpl.Instant)
    expect(record.zonedDateTime!.toString()).toBe('2023-07-25T18:30:45Z')
    expect(record.zonedDateTimeWithPrecision).toBeInstanceOf(
      TemporalImpl.Instant,
    )
    expect(record.zonedDateTimeWithPrecision!.toString()).toBe(
      '2023-07-25T13:30:45.123Z',
    )

    expect(record.duration).toBeInstanceOf(TemporalImpl.Duration)
    expect(record.duration!.hours).toBe(2)
    expect(record.duration!.minutes).toBe(30)

    expect(record.yearMonthValue).toBeInstanceOf(TemporalImpl.PlainYearMonth)
    expect(record.yearMonthValue!.toString()).toBe('2023-07')

    expect(record.monthDayValue).toBeInstanceOf(TemporalImpl.PlainMonthDay)
    expect(record.monthDayValue!.toString()).toBe('07-25')
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

  it('should accept SQL expressions when inserting temporal columns', async () => {
    await db.insert(temporalTable).values({
      plainDate: sql`DATE '2023-07-25'`,
      plainTime: sql`TIME '14:30:45.123'`,
      plainDateTime: sql`TIMESTAMP '2023-07-25 14:30:45.123456'`,
      zonedDateTime: sql`TIMESTAMP WITH TIME ZONE '2023-07-25 14:30:45.123-04'`,
      duration: sql`INTERVAL '2 hours 30 minutes 15 seconds'`,
      yearMonthValue: sql`'2023-07'`,
      monthDayValue: sql`'07-25'`,
    })

    const result = await db.select().from(temporalTable).limit(1)
    const record = result[0]!

    expect(record.plainDate!.toString()).toBe('2023-07-25')
    expect(record.plainTime!.toString()).toBe('14:30:45.123')
    expect(record.plainDateTime!.toString()).toBe('2023-07-25T14:30:45.123456')
    expect(record.zonedDateTime).toBeInstanceOf(TemporalImpl.Instant)
    expect(record.zonedDateTime!.toString()).toBe('2023-07-25T18:30:45.123Z')
    expect(record.duration!.hours).toBe(2)
    expect(record.duration!.minutes).toBe(30)
    expect(record.duration!.seconds).toBe(15)
    expect(record.yearMonthValue!.toString()).toBe('2023-07')
    expect(record.monthDayValue!.toString()).toBe('07-25')
  })

  it('should handle null values correctly', async () => {
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
    const testDate1 = TemporalImpl.PlainDate.from('2023-01-01')
    const testDate2 = TemporalImpl.PlainDate.from('2023-12-31')

    await db.insert(temporalTable).values({ plainDate: testDate1 })
    await db.insert(temporalTable).values({ plainDate: testDate2 })

    // Query for dates in a specific range
    const results = await db
      .select({ plainDate: temporalTable.plainDate })
      .from(temporalTable)
      .where(
        gte(temporalTable.plainDate, Temporal.PlainDate.from('2023-06-01')),
      )

    expect(results.length).toBeGreaterThan(0)
    results.forEach((result) => {
      if (result.plainDate) {
        expect(result.plainDate.toString() >= '2023-06-01').toBe(true)
      }
    })
  })
})
