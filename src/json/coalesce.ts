import { type SQL, sql } from 'drizzle-orm'
import {
  normalizeNullish,
  type SQLJSONDenullify,
  type SQLJSONExtractType,
  type SQLJSONValue,
} from './common.ts'

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
  return sql`json_query(${normalizeNullish(source)}, 'strict $ ? (@ != null)' default ${value} on empty)::jsonb`
}
