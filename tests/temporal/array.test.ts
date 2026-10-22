import { sql } from 'drizzle-orm'
import { pgTable, serial } from 'drizzle-orm/pg-core'
import { Temporal } from 'temporal-polyfill'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  interval,
  monthDay,
  yearMonth,
  plainDate,
  time,
  timestamp,
  timestampz,
} from '../../src/temporal/polyfill.ts'
import { createDatabase, type TestDatabase, testDriver } from '../utils.ts'

// Array columns rely on each column's drizzle codec to read elements as text.
// A codec name drizzle doesn't recognize leaves the raw array literal unparsed.
const temporalArrayTable = pgTable('temporal_array_test', {
  id: serial('id').primaryKey(),
  plainDates: plainDate.column('plain_dates').array(),
  plainTimes: time.column('plain_times').array(),
  plainDateTimes: timestamp.column('plain_datetimes').array(),
  instants: timestampz.column('instants').array(),
  durations: interval.column('durations').array(),
  yearMonths: yearMonth.column('year_months').array(),
  monthDays: monthDay.column('month_days').array(),
  dateMatrix: plainDate.column('date_matrix').array('[][]'),
})

let db: TestDatabase

beforeAll(async () => {
  db = await createDatabase()

  await db.execute(sql`SET intervalstyle = 'iso_8601'`)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS temporal_array_test (
      id SERIAL PRIMARY KEY,
      plain_dates DATE[],
      plain_times TIME[],
      plain_datetimes TIMESTAMP[],
      instants TIMESTAMP WITH TIME ZONE[],
      durations INTERVAL[],
      year_months TEXT[],
      month_days TEXT[],
      date_matrix DATE[][]
    )
  `)
})

beforeEach(async () => {
  await db.delete(temporalArrayTable)
})

describe('Temporal array columns', () => {
  it('decodes partial dates, multidimensional arrays, and empty arrays', async () => {
    const [record] = await db
      .insert(temporalArrayTable)
      .values({
        yearMonths: [
          Temporal.PlainYearMonth.from('-000001-02'),
          Temporal.PlainYearMonth.from('2026-10'),
        ],
        monthDays: [Temporal.PlainMonthDay.from('02-29')],
        dateMatrix: [
          [Temporal.PlainDate.from('0000-01-02')],
          [Temporal.PlainDate.from('2026-10-22')],
        ],
        durations: [Temporal.Duration.from('-PT1H')],
        plainTimes: [],
      })
      .returning()
    expect(record!.yearMonths!.map(String)).toEqual(['-000001-02', '2026-10'])
    expect(record!.monthDays!.map(String)).toEqual(['02-29'])
    expect(record!.dateMatrix!.map((row) => row.map(String))).toEqual([
      ['0000-01-02'],
      ['2026-10-22'],
    ])
    expect(record!.durations![0]!.toString()).toBe('-PT1H')
    expect(record!.plainTimes).toEqual([])
  })

  // Drizzle rc.5's postgres-js array parser turns unquoted SQL NULL into the
  // string 'NULL'. Other drivers preserve null; detect an upstream fix.
  const nullElementTest = testDriver === 'postgres-js' ? it.fails : it
  nullElementTest('preserves SQL NULL array elements', async () => {
    const [record] = await db
      .insert(temporalArrayTable)
      .values({
        plainDates: sql`array[date '2026-10-22', null]`,
      })
      .returning()
    expect(record!.plainDates![0]!.toString()).toBe('2026-10-22')
    expect(record!.plainDates![1]).toBeNull()
  })

  it('round-trips arrays with microsecond precision', async () => {
    await db.insert(temporalArrayTable).values({
      plainDates: [
        Temporal.PlainDate.from('2023-07-25'),
        Temporal.PlainDate.from('2024-02-29'),
      ],
      plainTimes: [Temporal.PlainTime.from('14:30:45.123456')],
      plainDateTimes: [
        Temporal.PlainDateTime.from('2023-07-25T14:30:45.123456'),
        Temporal.PlainDateTime.from('2024-02-29T00:00:00.000001'),
      ],
      instants: [Temporal.Instant.from('2023-07-25T14:30:45.123456Z')],
      durations: [Temporal.Duration.from('P1DT2H30M')],
    })

    const [record] = await db.select().from(temporalArrayTable)

    expect(record!.plainDates!.map(String)).toEqual([
      '2023-07-25',
      '2024-02-29',
    ])
    expect(record!.plainTimes!.map(String)).toEqual(['14:30:45.123456'])
    expect(record!.plainDateTimes!.map(String)).toEqual([
      '2023-07-25T14:30:45.123456',
      '2024-02-29T00:00:00.000001',
    ])
    expect(record!.instants![0]).toBeInstanceOf(Temporal.Instant)
    expect(record!.instants!.map(String)).toEqual([
      '2023-07-25T14:30:45.123456Z',
    ])
    expect(record!.durations!.map(String)).toEqual(['P1DT2H30M'])
  })
})
