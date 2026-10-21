import { type SQL, sql } from 'drizzle-orm'

import { jsonSource } from '../source.ts'
import type {
  SQLJSONDenullify,
  SQLJSONExtractType,
  SQLJSONValue,
} from '../types.ts'
import {
  jsonBuild,
  type SQLJSONBuildMixedType,
  type SQLJSONBuildUnwrapType,
} from './build.ts'

/**
 * Coalesce two JSON values, returning the first non-nullish value.
 * This handles both JSON null and SQL null values.
 */
export function jsonCoalesce<
  Source extends SQLJSONValue,
  Value extends SQLJSONBuildMixedType,
>(
  source: Source,
  value: Value,
): SQL<
  SQLJSONDenullify<SQLJSONExtractType<Source>> | SQLJSONBuildUnwrapType<Value>
> {
  return sql`coalesce(nullif(${jsonSource(source)}, 'null'::jsonb), ${jsonBuild(value)})`
}
