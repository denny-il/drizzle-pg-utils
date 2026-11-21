import * as PgTypes from '@effect/sql-pg/PgTypes'
import { refineCodecs } from 'drizzle-orm/codecs'
import { effectPgCodecs } from 'drizzle-orm/effect-postgres'
import {
  arrayCompatNormalize,
  type PgCodecs,
  textToDate,
  textToDateWithTz,
} from 'drizzle-orm/pg-core'
import * as Result from 'effect/Result'

// Since drizzle-orm 1.0.0-rc.6, selected columns are no longer cast to text,
// and @effect/sql-pg decodes the binary protocol itself: `timestamp` and
// `timestamptz` arrive as millisecond `Date`s and `interval` as an object.
// `date` and `time` already arrive lossless and drizzle formats them as
// PostgreSQL text, so they need nothing here.

const microsPerDay = 86_400_000_000n
const int64Max = 0x7fffffffffffffffn
const int64Min = -0x8000000000000000n
const int32Max = 0x7fffffff
const int32Min = -0x80000000
// Days from 1970-01-01 to 2000-01-01, PostgreSQL's binary epoch.
const pgEpochDays = 10_957n

const pad = (value: bigint | number, width = 2) =>
  String(value).padStart(width, '0')

const fraction = (micros: bigint) =>
  micros === 0n ? '' : `.${pad(micros, 6).replace(/0+$/, '')}`

// Proleptic Gregorian date from days since 1970-01-01, after Howard Hinnant's
// `civil_from_days`. BigInt keeps PostgreSQL's whole range (up to year 294276)
// exact, beyond what `Date` can hold. The year is astronomical: 0 is 1 BC.
const civilFromDays = (days: bigint) => {
  const z = days + 719_468n
  const era = (z >= 0n ? z : z - 146_096n) / 146_097n
  const dayOfEra = z - era * 146_097n
  const yearOfEra =
    (dayOfEra - dayOfEra / 1_460n + dayOfEra / 36_524n - dayOfEra / 146_096n) /
    365n
  const dayOfYear =
    dayOfEra - (365n * yearOfEra + yearOfEra / 4n - yearOfEra / 100n)
  const mp = (5n * dayOfYear + 2n) / 153n
  const day = dayOfYear - (153n * mp + 2n) / 5n + 1n
  const month = mp < 10n ? mp + 3n : mp - 9n
  const year = yearOfEra + era * 400n + (month <= 2n ? 1n : 0n)
  return { year, month, day }
}

// The text PostgreSQL prints with `DateStyle = ISO`. `timestamptz` is printed
// in UTC (`+00`): binary values carry no session time zone, and the instant
// is the same.
const timestampText = (withTimeZone: boolean) => (bytes: Uint8Array) => {
  const micros = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getBigInt64(0)
  if (micros === int64Max) return Result.succeed('infinity')
  if (micros === int64Min) return Result.succeed('-infinity')
  // BigInt division truncates toward zero; times before the epoch need floor.
  let days = micros / microsPerDay
  let time = micros % microsPerDay
  if (time < 0n) {
    time += microsPerDay
    days -= 1n
  }
  const { year, month, day } = civilFromDays(days + pgEpochDays)
  const seconds = time / 1_000_000n
  const text =
    `${pad(year > 0n ? year : 1n - year, 4)}-${pad(month)}-${pad(day)} ` +
    `${pad(seconds / 3_600n)}:${pad((seconds / 60n) % 60n)}:${pad(seconds % 60n)}` +
    `${fraction(time % 1_000_000n)}${withTimeZone ? '+00' : ''}${year > 0n ? '' : ' BC'}`
  return Result.succeed(text)
}

/**
 * Registers lossless decoders for `timestamp` and `timestamptz` (and their
 * arrays) on an @effect/sql-pg type registry, so the client returns them as
 * PostgreSQL text instead of millisecond `Date`s. Pass the registry as the
 * `PgClient` `types` option, together with {@link temporalCodecs}.
 *
 * The registry is client-wide: Effect `sql` queries and `db.execute(...)` on
 * that client also get these types as strings. `timestamptz` text is in UTC.
 *
 * @param registry - Registry to add the decoders to; it is mutated and
 * returned. Defaults to a new registry.
 */
export function temporalPgTypes(
  registry: PgTypes.Registry = PgTypes.makeRegistry(),
): PgTypes.Registry {
  for (const [oid, arrayOid, withTimeZone] of [
    [PgTypes.OID.timestamp, PgTypes.OID.timestampArray, false],
    [PgTypes.OID.timestamptz, PgTypes.OID.timestamptzArray, true],
  ] as const) {
    registry.register<unknown>(
      oid,
      {
        // Parameters keep the driver's built-in encoder: `Date` parameters
        // are bound as typed `timestamptz` values.
        encode: (value) => PgTypes.encode(value, oid),
        decode: timestampText(withTimeZone),
      },
      { arrayOid },
    )
  }
  return registry
}

// PostgreSQL's `intervalstyle = iso_8601` output (EncodeInterval): each field
// keeps its own sign, as Postgres stores months, days and microseconds apart.
const intervalText = (value: PgTypes.Interval) => {
  const { months, days, microseconds } = value
  if (months === int32Max && days === int32Max && microseconds === int64Max)
    return 'infinity'
  if (months === int32Min && days === int32Min && microseconds === int64Min)
    return '-infinity'
  const hours = microseconds / 3_600_000_000n
  const minutes = (microseconds / 60_000_000n) % 60n
  const seconds = (microseconds / 1_000_000n) % 60n
  const micros = microseconds % 1_000_000n
  const part = (n: bigint | number, unit: string) => (n ? `${n}${unit}` : '')
  const date = `${part(Math.trunc(months / 12), 'Y')}${part(months % 12, 'M')}${part(days, 'D')}`
  if (!microseconds) return date ? `P${date}` : 'PT0S'
  const abs = (n: bigint) => (n < 0n ? -n : n)
  const secondsText =
    seconds || micros
      ? `${microseconds < 0n ? '-' : ''}${abs(seconds)}${fraction(abs(micros))}S`
      : ''
  return `P${date}T${part(hours, 'H')}${part(minutes, 'M')}${secondsText}`
}

/**
 * The effect-postgres driver's codecs, adjusted for {@link temporalPgTypes}:
 * `timestamp` and `timestamptz` columns decode the registry's text (in string
 * and `Date` modes), and `interval` columns decode the driver's interval
 * object to ISO 8601 text, as the Temporal `interval` column expects.
 * drizzle's own `interval()` columns get that text too.
 *
 * @param base - Codecs to refine; defaults to drizzle's `effectPgCodecs`.
 */
export function temporalCodecs(base: PgCodecs = effectPgCodecs): PgCodecs {
  return refineCodecs(base, {
    'timestamp:string': { normalize: undefined, normalizeArray: undefined },
    'timestamptz:string': { normalize: undefined, normalizeArray: undefined },
    timestamp: {
      normalize: textToDateWithTz,
      normalizeArray: arrayCompatNormalize(textToDateWithTz),
    },
    timestamptz: {
      normalize: textToDate,
      normalizeArray: arrayCompatNormalize(textToDate),
    },
    interval: {
      normalize: intervalText,
      normalizeArray: arrayCompatNormalize(intervalText),
    },
  })
}
