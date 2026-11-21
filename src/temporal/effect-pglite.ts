import { refineCodecs } from 'drizzle-orm/codecs'
import { effectPgliteCodecs } from 'drizzle-orm/effect-pglite'
import {
  arrayCompatNormalize,
  type PgCodecs,
  textToDate,
  textToDateWithTz,
} from 'drizzle-orm/pg-core'

// Since drizzle-orm 1.0.0-rc.6, selected columns are no longer cast to text,
// and PGlite parses `date`, `timestamp` and `timestamptz` into `Date`s, which
// drop microseconds and, for `timestamp`, read the value in process-local
// time. `time` and `interval` already arrive as PostgreSQL text.

const keepText = (value: string) => value

/**
 * PGlite `parsers` that keep `date`, `timestamp` and `timestamptz` (and their
 * array elements) as the text PostgreSQL prints. Pass them to the PGlite
 * instance or `PgliteClient.layer({ parsers })`, together with
 * {@link temporalCodecs}.
 *
 * Parsers are instance-wide: Effect `sql` queries and `db.execute(...)` also
 * get these types as strings.
 */
export const temporalPgliteParsers = {
  1082: keepText, // date
  1114: keepText, // timestamp
  1184: keepText, // timestamptz
}

/**
 * The effect-pglite driver's codecs, adjusted for
 * {@link temporalPgliteParsers}: `date`, `timestamp` and `timestamptz` columns
 * decode PostgreSQL text, in string and `Date` modes.
 *
 * @param base - Codecs to refine; defaults to drizzle's `effectPgliteCodecs`.
 */
export function temporalCodecs(base: PgCodecs = effectPgliteCodecs): PgCodecs {
  return refineCodecs(base, {
    'date:string': { normalize: undefined, normalizeArray: undefined },
    'timestamp:string': { normalize: undefined, normalizeArray: undefined },
    'timestamptz:string': { normalize: undefined, normalizeArray: undefined },
    date: {
      normalize: textToDate,
      normalizeArray: arrayCompatNormalize(textToDate),
    },
    timestamp: {
      normalize: textToDateWithTz,
      normalizeArray: arrayCompatNormalize(textToDateWithTz),
    },
    timestamptz: {
      normalize: textToDate,
      normalizeArray: arrayCompatNormalize(textToDate),
    },
  })
}
