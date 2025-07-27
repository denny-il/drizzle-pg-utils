import { type SQL, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

export type SQLJSONValue<T = any> =
  | SQL<T>
  | SQL.Aliased<T>
  | AnyPgColumn<{ dataType: 'json'; data: T }>
  | AnyPgColumn<{ dataType: 'custom'; data: T }>

export type SQLJSONNullish = null | undefined

export type SQLJSONIsNullish<Type> = null extends Type
  ? true
  : undefined extends Type
    ? true
    : false

export type SQLJSONNullify<
  IsNullish extends boolean,
  Type,
> = IsNullish extends true ? Exclude<Type, SQLJSONNullish> | null : Type

export type SQLJSONDenullify<Type> = Exclude<Type, SQLJSONNullish>

/**
 * Extract the data type from a SQLJSONValue (Column or SQL)
 */
export type SQLJSONExtractType<Source extends SQLJSONValue> =
  Source['_'] extends { brand: 'Column' }
    ? Source['_']['data']
    : Source['_'] extends { brand: 'SQL' } | { brand: 'SQL.Aliased' }
      ? Source['_']['type']
      : never

export const normalizeNullish = <T>(
  value: SQLJSONValue<T>,
): SQLJSONIsNullish<T> extends true ? SQL<T> : never => {
  return sql<T>`coalesce(${value}, 'null'::jsonb)` as any
}
