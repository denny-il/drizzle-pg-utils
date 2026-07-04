import { type SQL, sql } from 'drizzle-orm'
import type {
  SQLJSONDenullify,
  SQLJSONExtractType,
  SQLJSONValue,
} from '../types.ts'
import { jsonBuild } from './build.ts'

/**
 * Coalesce two JSON values, returning the first non-nullish value.
 * This handles both JSON null and SQL null values.
 */
export function jsonCoalesce<
  Source extends SQLJSONValue,
  Value extends SQLJSONValue,
>(
  source: Source,
  value: Value,
): SQL<
  SQLJSONDenullify<SQLJSONExtractType<Source>> | SQLJSONExtractType<Value>
> {
  return sql`coalesce(nullif(${source}, 'null'::jsonb), ${jsonBuild(value as any)})`
}
