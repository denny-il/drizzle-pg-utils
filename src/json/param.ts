import { type SQL, sql } from 'drizzle-orm'

/**
 * Binds a JS value as a jsonb parameter. The param is cast via text so drivers
 * that infer `$n::jsonb` as a jsonb param (postgres-js) don't JSON-encode the
 * already serialized string a second time.
 */
export function jsonbParam(value: unknown): SQL {
  return sql`${JSON.stringify(value)}::text::jsonb`
}
