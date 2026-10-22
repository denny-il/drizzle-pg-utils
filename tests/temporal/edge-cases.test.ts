import { sql } from 'drizzle-orm'
import { getTableConfig, pgTable } from 'drizzle-orm/pg-core'
import { Temporal } from 'temporal-polyfill'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  interval,
  monthDay,
  plainDate,
  timestamp,
  timestampz,
  yearMonth,
} from '../../src/temporal/polyfill.ts'
import { createDatabase, type TestDatabase, testDriver } from '../utils.ts'

const dates = pgTable(
  'temporal_edge_cases',
  {
    date: plainDate.column(),
    duration: interval.column(),
    timestamp: timestamp.column(),
    instant: timestampz.column(),
    yearMonth: yearMonth.column(),
    monthDay: monthDay.column(),
  },
  (table) => [
    ...yearMonth.constraints(table.yearMonth),
    ...monthDay.constraints(table.monthDay),
  ],
)

let db: TestDatabase
beforeAll(async () => {
  db = await createDatabase()
  await db.execute(sql`set intervalstyle = 'iso_8601'`)
  const checks = getTableConfig(dates).checks.map(
    (check) =>
      sql`constraint ${sql.identifier(check.name)} check (${check.value})`,
  )
  await db.execute(
    sql`create table temporal_edge_cases (date date, duration interval, timestamp timestamp, instant timestamptz, "yearMonth" text, "monthDay" text, ${sql.join(checks, sql`, `)})`,
  )
})

describe('Temporal edge cases', () => {
  for (const value of ['0000-01-02', '-000001-03-04', '+010000-05-06']) {
    // @effect/sql-pg decodes dates itself and returns a 4-digit signed year
    // (`-0001-03-04`) for dates before year 0, which Temporal rejects.
    it.skipIf(testDriver === 'effect-postgres' && value.startsWith('-'))(
      `round-trips ISO year ${value} through native date and timestamp columns`,
      async () => {
        const date = Temporal.PlainDate.from(value)
        const plain = Temporal.PlainDateTime.from(`${value}T12:34:56.123456`)
        const instant = Temporal.Instant.from(`${value}T12:34:56.123456Z`)
        const [row] = await db
          .insert(dates)
          .values({ date, timestamp: plain, instant })
          .returning()
        expect(row!.date!.equals(date)).toBe(true)
        expect(row!.timestamp!.equals(plain)).toBe(true)
        expect(row!.instant!.equals(instant)).toBe(true)
      },
    )
  }

  it.each(['-PT1H', '-P1Y2M3DT4H5M6.123456S', 'PT0S'])(
    'round-trips signed duration %s',
    async (value) => {
      const duration = Temporal.Duration.from(value)
      const [row] = await db.insert(dates).values({ duration }).returning()
      expect(row!.duration!.toString()).toBe(duration.toString())
    },
  )

  it('enforces the actual exported partial-date constraints', async () => {
    const [row] = await db
      .insert(dates)
      .values({
        yearMonth: Temporal.PlainYearMonth.from('-271821-04'),
        monthDay: Temporal.PlainMonthDay.from('02-29'),
      })
      .returning()
    expect(row!.yearMonth!.toString()).toBe('-271821-04')
    expect(row!.monthDay!.toString()).toBe('02-29')
    await expect(
      db.execute(
        sql`insert into temporal_edge_cases ("yearMonth") values ('+275760-10')`,
      ),
    ).rejects.toThrow()
    await expect(
      db.execute(
        sql`insert into temporal_edge_cases ("monthDay") values ('02-30')`,
      ),
    ).rejects.toThrow()
  })
})
