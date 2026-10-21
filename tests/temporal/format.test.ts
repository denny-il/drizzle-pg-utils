import { sql } from 'drizzle-orm'
import { Temporal } from 'temporal-polyfill'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  fromPostgresDateTime,
  fromPostgresInterval,
  toPostgresDateTime,
  toPostgresInterval,
} from '../../src/temporal/format.ts'
import {
  closeDatabase,
  createDatabase,
  executeQuery,
  type TestDatabase,
} from '../utils.ts'

const dateCases = [
  ['0001-01-01', '0001-01-01'],
  ['0000-01-01', '0001-01-01 BC'],
  ['0000-02-29', '0001-02-29 BC'],
  ['-000001-01-01', '0002-01-01 BC'],
  ['-000043-03-15', '0044-03-15 BC'],
  ['-000099-12-31', '0100-12-31 BC'],
  ['0099-12-31', '0099-12-31'],
  ['0999-12-31', '0999-12-31'],
  ['1000-01-01', '1000-01-01'],
  ['2026-10-22', '2026-10-22'],
  ['9999-12-31', '9999-12-31'],
  ['+010000-01-01', '10000-01-01'],
  ['+099999-12-31', '99999-12-31'],
  ['+100000-01-01', '100000-01-01'],
  ['+100001-01-01', '100001-01-01'],
  ['-009998-12-31', '9999-12-31 BC'],
  ['-009999-01-01', '10000-01-01 BC'],
  ['-010000-01-01', '10001-01-01 BC'],
  ['-099998-12-31', '99999-12-31 BC'],
  ['-099999-01-01', '100000-01-01 BC'],
  ['-100000-01-01', '100001-01-01 BC'],
  ['-271821-04-19', '271822-04-19 BC'],
  ['+271821-10-22', '271821-10-22'],
  ['+275760-09-13', '275760-09-13'],
] as const

const dateTimeCases = [
  ['0001-01-01T00:00:00', '0001-01-01T00:00:00'],
  ['0099-12-31T23:59:59', '0099-12-31T23:59:59'],
  ['0000-02-29T12:34:56.123456789', '0001-02-29T12:34:56.123456789 BC'],
  ['-000001-01-01T00:00:00', '0002-01-01T00:00:00 BC'],
  ['-000043-03-15T12:00:00Z', '0044-03-15T12:00:00Z BC'],
  ['+010000-01-01T00:00:00Z', '10000-01-01T00:00:00Z'],
  ['+099999-12-31T23:59:59.999999999', '99999-12-31T23:59:59.999999999'],
  ['+100000-01-01T00:00:00Z', '100000-01-01T00:00:00Z'],
  // PlainDateTime extends one day beyond Instant at each end of the range.
  ['-271821-04-19T00:00:00.000000001', '271822-04-19T00:00:00.000000001 BC'],
  ['+275760-09-13T23:59:59.999999999', '275760-09-13T23:59:59.999999999'],
  ['-271821-04-20T00:00:00Z', '271822-04-20T00:00:00Z BC'],
  ['+275760-09-13T00:00:00Z', '275760-09-13T00:00:00Z'],
] as const

const fractions = [
  '',
  '.1',
  '.12',
  '.123',
  '.1234',
  '.12345',
  '.123456',
  '.1234567',
  '.12345678',
  '.123456789',
  '.000000000',
  '.100000000',
] as const

const offsetCases = ['', 'Z', '+00', '+05:30', '-08:00'] as const

// Sample the full supported range, then densely sample era and digit boundaries.
// Temporal supplies the year spelling, independently of the conversion helpers.
const sweepYears = [
  ...new Set([
    ...Array.from({ length: 70 }, (_, index) => -271000 + index * 7919),
    ...[-100000, -10000, 0, 10000, 100000].flatMap((year) =>
      Array.from({ length: 7 }, (_, index) => year + index - 3),
    ),
    -271821,
    271821,
    275760,
  ]),
]

describe('date/time format conversions', () => {
  describe('toPostgresDateTime', () => {
    it.each(dateCases)('converts ISO date %s to %s', (temporal, postgres) => {
      expect(toPostgresDateTime(temporal)).toBe(postgres)
    })

    it.each(dateTimeCases)(
      'converts ISO timestamp %s to %s',
      (temporal, postgres) => {
        expect(toPostgresDateTime(temporal)).toBe(postgres)
      },
    )

    it.each(fractions)('preserves fractional seconds %j', (fraction) => {
      expect(toPostgresDateTime(`2026-10-22T12:34:56${fraction}`)).toBe(
        `2026-10-22T12:34:56${fraction}`,
      )
      expect(toPostgresDateTime(`-000043-03-15T12:34:56${fraction}Z`)).toBe(
        `0044-03-15T12:34:56${fraction}Z BC`,
      )
    })

    it.each(offsetCases)('preserves the offset %j', (offset) => {
      expect(toPostgresDateTime(`0000-01-01T12:34:56.123456${offset}`)).toBe(
        `0001-01-01T12:34:56.123456${offset} BC`,
      )
      expect(toPostgresDateTime(`+010000-01-01T12:34:56${offset}`)).toBe(
        `10000-01-01T12:34:56${offset}`,
      )
    })

    it.each([...dateCases, ...dateTimeCases])(
      'leaves PostgreSQL spelling %s unchanged on a second conversion',
      (temporal, postgres) => {
        expect(toPostgresDateTime(toPostgresDateTime(temporal))).toBe(postgres)
      },
    )
  })

  describe('fromPostgresDateTime', () => {
    it.each(dateCases)(
      'converts PostgreSQL date %s / %s',
      (temporal, postgres) => {
        expect(fromPostgresDateTime(postgres)).toBe(temporal)
      },
    )

    it.each(dateTimeCases)(
      'converts PostgreSQL timestamp %s / %s',
      (temporal, postgres) => {
        expect(fromPostgresDateTime(postgres)).toBe(temporal)
      },
    )

    it.each(fractions)(
      'preserves fractional seconds %j and the space',
      (fraction) => {
        expect(fromPostgresDateTime(`2026-10-22 12:34:56${fraction}`)).toBe(
          `2026-10-22 12:34:56${fraction}`,
        )
        expect(
          fromPostgresDateTime(`0044-03-15 12:34:56${fraction}+00 BC`),
        ).toBe(`-000043-03-15 12:34:56${fraction}+00`)
      },
    )

    it.each(offsetCases)('preserves the offset %j and the space', (offset) => {
      expect(
        fromPostgresDateTime(`0001-01-01 12:34:56.123456${offset} BC`),
      ).toBe(`0000-01-01 12:34:56.123456${offset}`)
      expect(fromPostgresDateTime(`10000-01-01 12:34:56${offset}`)).toBe(
        `+010000-01-01 12:34:56${offset}`,
      )
    })

    it.each([...dateCases, ...dateTimeCases])(
      'leaves Temporal spelling %s unchanged on a second conversion',
      (temporal, postgres) => {
        expect(fromPostgresDateTime(fromPostgresDateTime(postgres))).toBe(
          temporal,
        )
      },
    )

    it.each(['infinity', '-infinity'])(
      'passes PostgreSQL %s through for Temporal to reject',
      (value) => {
        expect(fromPostgresDateTime(value)).toBe(value)
        expect(() =>
          Temporal.PlainDate.from(fromPostgresDateTime(value)),
        ).toThrow(RangeError)
      },
    )
  })

  describe('round trips', () => {
    it.each(dateCases)(
      'round-trips date %s through Temporal and both helpers',
      (temporal, postgres) => {
        const input = Temporal.PlainDate.from(temporal).toString({
          calendarName: 'never',
        })
        expect(fromPostgresDateTime(toPostgresDateTime(input))).toBe(temporal)
        const output = Temporal.PlainDate.from(
          fromPostgresDateTime(postgres),
        ).toString({ calendarName: 'never' })
        expect(toPostgresDateTime(output)).toBe(postgres)
      },
    )

    it.each(dateTimeCases)(
      'round-trips canonical timestamp %s through Temporal and both helpers',
      (temporal) => {
        const parsed = temporal.endsWith('Z')
          ? Temporal.Instant.from(temporal)
          : Temporal.PlainDateTime.from(temporal)
        const input = parsed.toString()
        expect(fromPostgresDateTime(toPostgresDateTime(input))).toBe(temporal)
      },
    )

    it.each(sweepYears)(
      'round-trips date, timestamp and instant in year %i',
      (year) => {
        const date = Temporal.PlainDate.from({ year, month: 6, day: 15 })
        const timestamp = date.toPlainDateTime('12:34:56.123456789')
        const instant = timestamp.toZonedDateTime('UTC').toInstant()
        for (const value of [date, timestamp, instant]) {
          const input = value.toString()
          expect(fromPostgresDateTime(toPostgresDateTime(input))).toBe(input)
        }
      },
    )
  })
})

const intervalCases = [
  ['PT0S', 'PT0S'],
  ['P1Y', 'P1Y'],
  ['P1M', 'P1M'],
  ['P1W', 'P1W'],
  ['P1D', 'P1D'],
  ['PT1H', 'PT1H'],
  ['PT1M', 'PT1M'],
  ['PT1S', 'PT1S'],
  ['PT0.5S', 'PT0.5S'],
  ['PT1.000001S', 'PT1.000001S'],
  ['PT0.000000001S', 'PT0.000000001S'],
  ['P1DT3H', 'P1DT3H'],
  ['P1Y2M3W4DT5H6M7.123456789S', 'P1Y2M3W4DT5H6M7.123456789S'],
  ['PT100000H', 'PT100000H'],
  ['-P1Y', 'P-1Y'],
  ['-P1M', 'P-1M'],
  ['-P1W', 'P-1W'],
  ['-P1D', 'P-1D'],
  ['-PT1H', 'PT-1H'],
  ['-PT1M', 'PT-1M'],
  ['-PT1S', 'PT-1S'],
  ['-PT0.5S', 'PT-0.5S'],
  ['-PT1.000001S', 'PT-1.000001S'],
  ['-PT0.000000001S', 'PT-0.000000001S'],
  ['-PT1.123456789S', 'PT-1.123456789S'],
  ['-P1DT3H', 'P-1DT-3H'],
  ['-P1Y2M3W4DT5H6M7.123456789S', 'P-1Y-2M-3W-4DT-5H-6M-7.123456789S'],
  ['-PT100000H', 'PT-100000H'],
] as const

const zeroFieldIntervalCases = [
  ['P-1DT0H', '-P1DT0H', '-P1D'],
  ['P-1DT-0H', '-P1DT0H', '-P1D'],
  ['P0Y-1M0DT0H0M-0.5S', '-P0Y1M0DT0H0M0.5S', '-P1MT0.5S'],
  ['P0Y0M0DT0H0M-0.000000001S', '-P0Y0M0DT0H0M0.000000001S', '-PT0.000000001S'],
  ['P-1YT0.000000S', '-P1YT0.000000S', '-P1Y'],
] as const

const mixedSignIntervals = [
  'P1DT-3H',
  'P-1DT3H',
  'P1Y-2M',
  'P-1Y2M',
  'PT1H-30M',
  'PT-1H30M',
  'P1DT-0.5S',
  'P0DT1H-0.000001S',
] as const

describe('interval format conversions', () => {
  describe('toPostgresInterval', () => {
    it.each(intervalCases)('converts %s to %s', (temporal, postgres) => {
      expect(toPostgresInterval(temporal)).toBe(postgres)
    })

    it.each(intervalCases)(
      'is idempotent for the PostgreSQL form of %s',
      (temporal, postgres) => {
        expect(toPostgresInterval(toPostgresInterval(temporal))).toBe(postgres)
      },
    )

    it('signs zero seconds emitted by fixed-precision Temporal formatting', () => {
      const input = Temporal.Duration.from('-P1D').toString({
        fractionalSecondDigits: 6,
      })
      expect(toPostgresInterval(input)).toBe('P-1DT-0.000000S')
    })
  })

  describe('fromPostgresInterval', () => {
    it.each(intervalCases)('converts %s / %s', (temporal, postgres) => {
      expect(fromPostgresInterval(postgres)).toBe(temporal)
    })

    it.each(intervalCases)(
      'is idempotent for the Temporal form of %s',
      (temporal, postgres) => {
        expect(fromPostgresInterval(fromPostgresInterval(postgres))).toBe(
          temporal,
        )
      },
    )

    it.each(zeroFieldIntervalCases)(
      'converts negative and zero fields in %s',
      (postgres, temporal, canonical) => {
        expect(fromPostgresInterval(postgres)).toBe(temporal)
        expect(
          Temporal.Duration.from(fromPostgresInterval(postgres)).toString(),
        ).toBe(canonical)
      },
    )

    it.each(mixedSignIntervals)(
      'passes mixed signs in %s through for Temporal to reject',
      (postgres) => {
        expect(fromPostgresInterval(postgres)).toBe(postgres)
        expect(() =>
          Temporal.Duration.from(fromPostgresInterval(postgres)),
        ).toThrow(RangeError)
      },
    )
  })

  describe('round trips', () => {
    it.each(intervalCases)(
      'round-trips %s through Temporal and both helpers',
      (temporal, postgres) => {
        const input = Temporal.Duration.from(temporal).toString()
        expect(fromPostgresInterval(toPostgresInterval(input))).toBe(temporal)
        const output = Temporal.Duration.from(
          fromPostgresInterval(postgres),
        ).toString()
        expect(toPostgresInterval(output)).toBe(postgres)
      },
    )
  })
})

describe('PostgreSQL text format integration', () => {
  let db: TestDatabase

  beforeAll(async () => {
    db = await createDatabase()
    await db.execute(sql`set datestyle = 'ISO, YMD'`)
    await db.execute(sql`set timezone = 'UTC'`)
    await db.execute(sql`set intervalstyle = 'iso_8601'`)
  })

  afterAll(async () => {
    if (db) await closeDatabase(db)
  })

  it.each([
    ['0001-01-01', '0001-01-01'],
    ['0099-12-31', '0099-12-31'],
    ['0000-02-29', '0001-02-29 BC'],
    ['-000001-01-01', '0002-01-01 BC'],
    ['-000043-03-15', '0044-03-15 BC'],
    ['9999-12-31', '9999-12-31'],
    ['+010000-01-01', '10000-01-01'],
    ['+100000-01-01', '100000-01-01'],
    ['+275760-09-13', '275760-09-13'],
  ])('accepts and emits date %s / %s', async (temporal, postgres) => {
    const input = Temporal.PlainDate.from(temporal).toString({
      calendarName: 'never',
    })
    const emitted = await executeQuery(
      db,
      sql`${toPostgresDateTime(input)}::date::text`,
    )
    expect(emitted).toBe(postgres)
    const parsed = Temporal.PlainDate.from(fromPostgresDateTime(emitted))
    expect(parsed.equals(Temporal.PlainDate.from(temporal))).toBe(true)
    expect(toPostgresDateTime(parsed.toString({ calendarName: 'never' }))).toBe(
      postgres,
    )
  })

  it.each([
    ['2026-10-22T12:34:56.123456', '2026-10-22 12:34:56.123456'],
    ['0000-02-29T00:00:00', '0001-02-29 00:00:00 BC'],
    ['-000043-03-15T12:00:00.000001', '0044-03-15 12:00:00.000001 BC'],
    ['+010000-01-01T23:59:59.999999', '10000-01-01 23:59:59.999999'],
  ])('accepts and emits timestamp %s / %s', async (temporal, postgres) => {
    const input = Temporal.PlainDateTime.from(temporal).toString()
    const emitted = await executeQuery(
      db,
      sql`${toPostgresDateTime(input)}::timestamp::text`,
    )
    expect(emitted).toBe(postgres)
    const parsed = Temporal.PlainDateTime.from(fromPostgresDateTime(emitted))
    expect(parsed.equals(Temporal.PlainDateTime.from(temporal))).toBe(true)
    expect(
      await executeQuery(
        db,
        sql`${toPostgresDateTime(parsed.toString())}::timestamp::text`,
      ),
    ).toBe(postgres)
  })

  it.each([
    ['2026-10-22T12:34:56.123456Z', '2026-10-22 12:34:56.123456+00'],
    ['0000-02-29T00:00:00Z', '0001-02-29 00:00:00+00 BC'],
    ['-000043-03-15T12:00:00Z', '0044-03-15 12:00:00+00 BC'],
    ['+010000-01-01T00:00:00Z', '10000-01-01 00:00:00+00'],
    ['+275760-09-13T00:00:00Z', '275760-09-13 00:00:00+00'],
  ])('accepts and emits timestamptz %s / %s', async (temporal, postgres) => {
    const input = Temporal.Instant.from(temporal).toString()
    const emitted = await executeQuery(
      db,
      sql`${toPostgresDateTime(input)}::timestamptz::text`,
    )
    expect(emitted).toBe(postgres)
    const parsed = Temporal.Instant.from(fromPostgresDateTime(emitted))
    expect(parsed.equals(Temporal.Instant.from(temporal))).toBe(true)
    expect(
      await executeQuery(
        db,
        sql`${toPostgresDateTime(parsed.toString())}::timestamptz::text`,
      ),
    ).toBe(postgres)
  })

  it.each([
    ['+05:30', '2026-10-22 18:04:56.123456+05:30'],
    ['-08:00', '2026-10-22 04:34:56.123456-08'],
  ])('parses the actual session offset %s', async (offset, postgres) => {
    // POSIX timezone signs are reversed; an interval sets the intended UTC offset.
    await db.execute(
      sql`set time zone interval ${sql.raw(`'${offset}'`)} hour to minute`,
    )
    try {
      const emitted = await executeQuery(
        db,
        sql`'2026-10-22T12:34:56.123456Z'::timestamptz::text`,
      )
      expect(emitted).toBe(postgres)
      const parsed = Temporal.Instant.from(fromPostgresDateTime(emitted))
      expect(parsed.toString()).toBe('2026-10-22T12:34:56.123456Z')
      expect(
        await executeQuery(
          db,
          sql`${toPostgresDateTime(parsed.toString())}::timestamptz::text`,
        ),
      ).toBe(postgres)
    } finally {
      await db.execute(sql`set timezone = 'UTC'`)
    }
  })

  it.each([
    ['PT0S', 'PT0S', 'PT0S'],
    ['P1DT3H', 'P1DT3H', 'P1DT3H'],
    ['P1W', 'P7D', 'P7D'],
    ['-P1W', 'P-7D', '-P7D'],
    ['-P1Y', 'P-1Y', '-P1Y'],
    ['-P1M', 'P-1M', '-P1M'],
    ['-P1D', 'P-1D', '-P1D'],
    ['-PT1H', 'PT-1H', '-PT1H'],
    ['-PT1M', 'PT-1M', '-PT1M'],
    ['-PT0.5S', 'PT-0.5S', '-PT0.5S'],
    ['-PT1.000001S', 'PT-1.000001S', '-PT1.000001S'],
    ['-P1DT3H', 'P-1DT-3H', '-P1DT3H'],
    [
      'P1Y2M3W4DT5H6M7.123456S',
      'P1Y2M25DT5H6M7.123456S',
      'P1Y2M25DT5H6M7.123456S',
    ],
    [
      '-P1Y2M3W4DT5H6M7.123456S',
      'P-1Y-2M-25DT-5H-6M-7.123456S',
      '-P1Y2M25DT5H6M7.123456S',
    ],
  ])(
    'accepts %s and emits interval %s',
    async (temporal, postgres, canonical) => {
      const input = Temporal.Duration.from(temporal).toString()
      const emitted = await executeQuery(
        db,
        sql`${toPostgresInterval(input)}::interval::text`,
      )
      expect(emitted).toBe(postgres)
      const parsed = Temporal.Duration.from(fromPostgresInterval(emitted))
      expect(parsed.toString()).toBe(canonical)
      expect(toPostgresInterval(parsed.toString())).toBe(postgres)
    },
  )

  it.each(['-P1W', '-P1DT3H'])(
    'requires field signs instead of a leading sign for %s',
    async (value) => {
      await expect(
        executeQuery(db, sql`${value}::interval::text`),
      ).rejects.toThrow()
      expect(
        await executeQuery(
          db,
          sql`${toPostgresInterval(value)}::interval < interval '0'`,
        ),
      ).toBe(true)
    },
  )

  it.each(['P1DT-3H', 'P-1DT3H'])(
    'leaves actual mixed-sign PostgreSQL output %s for Temporal to reject',
    async (postgres) => {
      const emitted = await executeQuery(db, sql`${postgres}::interval::text`)
      expect(emitted).toBe(postgres)
      expect(fromPostgresInterval(emitted)).toBe(postgres)
      expect(() =>
        Temporal.Duration.from(fromPostgresInterval(emitted)),
      ).toThrow(RangeError)
    },
  )

  it('normalizes a negative interval with a zero field', async () => {
    const emitted = await executeQuery(db, sql`'P-1DT0H'::interval::text`)
    expect(emitted).toBe('P-1D')
    expect(
      Temporal.Duration.from(fromPostgresInterval(emitted)).toString(),
    ).toBe('-P1D')
  })
})
