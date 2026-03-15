import { sql } from 'drizzle-orm'
import { pgTable, serial } from 'drizzle-orm/pg-core'
import type { PgliteDatabase } from 'drizzle-orm/pglite'
import { Temporal as PolyfillTemporal } from 'temporal-polyfill'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createInterval,
  createMonthDay,
  createPlainDate,
  createTime,
  createTimestamp,
  createTimestampz,
  createYearMonth,
} from '../../src/temporal/index.ts'
import { createDatabase } from '../utils.ts'

const factoryTemporal = {
  interval: createInterval(PolyfillTemporal),
  monthDay: createMonthDay(PolyfillTemporal),
  plainDate: createPlainDate(PolyfillTemporal),
  time: createTime(PolyfillTemporal),
  timestamp: createTimestamp(PolyfillTemporal),
  timestampz: createTimestampz(PolyfillTemporal),
  yearMonth: createYearMonth(PolyfillTemporal),
}

const factoryTemporalTable = pgTable(
  'factory_temporal_test',
  {
    id: serial('id').primaryKey(),
    plainDate: factoryTemporal.plainDate.column('plain_date'),
    plainTime: factoryTemporal.time.column('plain_time'),
    plainDateTime: factoryTemporal.timestamp.column('plain_datetime'),
    zonedDateTime: factoryTemporal.timestampz.column('zoned_datetime', {
      precision: 3,
    }),
    duration: factoryTemporal.interval.column('duration', {
      precision: 2,
    }),
    yearMonthValue: factoryTemporal.yearMonth.column('year_month'),
    monthDayValue: factoryTemporal.monthDay.column('month_day'),
  },
  (table) => ({
    ...factoryTemporal.yearMonth.constraints(table.yearMonthValue),
    ...factoryTemporal.monthDay.constraints(table.monthDayValue),
  }),
)

let db: PgliteDatabase

beforeAll(async () => {
  db = await createDatabase()

  await db.execute(sql`SET intervalstyle = 'iso_8601'`)

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
      CONSTRAINT check_year_month_year_month_format CHECK ((year_month)::text ~ '^\\d{4}-((0[1-9])|(1([0-2])))$'),
      CONSTRAINT check_month_day_month_day_format CHECK ((month_day)::text ~ '^((0[1-9])|(1([0-2])))-((0[1-9])|([1-2][0-9])|(3[0-1]))$')
    )
  `)
})

beforeEach(async () => {
  await db.delete(factoryTemporalTable)
})

describe('Temporal Factory Tests', () => {
  it('should export the temporal factory helpers', async () => {
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

  it('should support factory-created columns with a caller-provided Temporal implementation', async () => {
    await db.insert(factoryTemporalTable).values({
      plainDate: PolyfillTemporal.PlainDate.from('2023-08-15'),
      plainTime: PolyfillTemporal.PlainTime.from('09:10:11.1234'),
      plainDateTime: PolyfillTemporal.PlainDateTime.from(
        '2023-08-15T09:10:11.123456',
      ),
      zonedDateTime: PolyfillTemporal.ZonedDateTime.from(
        '2023-08-15T09:10:11.1234[America/New_York]',
      ),
      duration: PolyfillTemporal.Duration.from('PT1H2M3.674S'),
      yearMonthValue: PolyfillTemporal.PlainYearMonth.from('2023-08'),
      monthDayValue: PolyfillTemporal.PlainMonthDay.from('08-15'),
    })

    const [result] = await db.select().from(factoryTemporalTable).limit(1)

    expect(result!.plainDate).toBeInstanceOf(PolyfillTemporal.PlainDate)
    expect(result!.plainDate?.toString()).toBe('2023-08-15')
    expect(result!.plainTime).toBeInstanceOf(PolyfillTemporal.PlainTime)
    expect(result!.plainDateTime).toBeInstanceOf(PolyfillTemporal.PlainDateTime)
    expect(result!.zonedDateTime).toBeInstanceOf(PolyfillTemporal.ZonedDateTime)
    expect(result!.zonedDateTime?.timeZoneId).toBe('UTC')
    expect(result!.duration).toBeInstanceOf(PolyfillTemporal.Duration)
    expect(result!.yearMonthValue).toBeInstanceOf(
      PolyfillTemporal.PlainYearMonth,
    )
    expect(result!.monthDayValue).toBeInstanceOf(PolyfillTemporal.PlainMonthDay)
  })
})
