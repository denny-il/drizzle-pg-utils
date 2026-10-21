import {
  is,
  isSQLWrapper,
  Param,
  Placeholder,
  type SQL,
  type SQLWrapper,
  sql,
} from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

import { jsonbParam } from '../param.ts'

export type SQLJSONBuildMixedPrimitiveType = string | number | boolean | null

export type SQLJSONBuildMixedArrayType = Array<SQLJSONBuildMixedType>

export type SQLJSONBuildMixedObjectType = {
  [key: string]: SQLJSONBuildMixedType
}

// Any SQL wrapper is accepted (it is converted with `to_jsonb`), including
// untyped `sql` snippets and non-JSON columns such as `users.id`.
export type SQLJSONBuildMixedType =
  | SQLJSONBuildMixedPrimitiveType
  | SQLJSONBuildMixedArrayType
  | SQLJSONBuildMixedObjectType
  | SQLWrapper

type SQLJSONColumnScalar<Data, Scalar> = Data extends readonly unknown[]
  ? { [K in keyof Data]: SQLJSONColumnScalar<Data[K], Scalar> }
  : Data extends null
    ? null
    : Scalar

// `to_jsonb(column)` sees database values, not the Date/bigint/custom objects
// produced by Drizzle's column decoders: timestamps become strings and
// numeric types become numbers. Unknown mappings (e.g. custom types) need an
// explicit SQL type.
type SQLJSONColumnData<T extends AnyPgColumn> =
  T['_']['dataType'] extends 'object date'
    ? SQLJSONColumnScalar<T['_']['data'], string>
    : T['_']['dataType'] extends
          | `bigint${string}`
          | 'string numeric'
          | 'string int64'
          | 'string uint64'
          | 'string unumeric'
      ? SQLJSONColumnScalar<T['_']['data'], number>
      : T['_']['dataType'] extends
            | `string${string}`
            | `number${string}`
            | 'boolean'
            | 'object json'
        ? T['_']['data']
        : unknown

type SQLJSONBuildColumnType<T extends AnyPgColumn> =
  | SQLJSONColumnData<T>
  | (T['_']['notNull'] extends true ? never : null)

export type SQLJSONBuildUnwrapType<T extends SQLJSONBuildMixedType> = T extends
  | SQL<infer U>
  | SQL.Aliased<infer U>
  ? U
  : T extends AnyPgColumn
    ? SQLJSONBuildColumnType<T>
    : T extends SQLWrapper
      ? unknown
      : T extends Array<SQLJSONBuildMixedType>
        ? Array<SQLJSONBuildUnwrapType<T[number]>>
        : T extends { [key: string]: SQLJSONBuildMixedType }
          ? {
              [K in keyof T]: SQLJSONBuildUnwrapType<T[K]>
            }
          : T

export function jsonBuild<T extends SQLJSONBuildMixedType>(
  value: T,
): SQL<SQLJSONBuildUnwrapType<T>> {
  // A bare param is `sql\`${value}\``, which drizzle builds as a single
  // bound value chunk. Single nested SQL chunks (e.g. from `sql.join`) are
  // expressions and still need `to_jsonb`.
  function isBareParamSQL(value: SQLWrapper) {
    const queryChunks = (value as { queryChunks?: unknown[] }).queryChunks
    if (!Array.isArray(queryChunks) || queryChunks.length !== 1) return false
    const [chunk] = queryChunks
    return !isSQLWrapper(chunk) || is(chunk, Param) || is(chunk, Placeholder)
  }

  function processValue(value: any): SQLWrapper {
    if (isSQLWrapper(value))
      return isBareParamSQL(value) ? value : sql`to_jsonb(${value})`

    // Handle arrays with mixed JS/SQL values
    if (Array.isArray(value)) {
      const processedElements = value
        .map((v) => (v === undefined ? null : v))
        .map(processValue)
      return sql`jsonb_build_array(${sql.join(processedElements, sql`,`)})`
    }

    // Handle objects with mixed JS/SQL values
    if (typeof value === 'object' && value !== null) {
      const entries = Object.entries(value).filter(
        ([_, val]) => val !== undefined,
      )
      const processedEntries = entries.map(
        ([key, val]) =>
          sql`${sql`${key}`.inlineParams()}, ${processValue(val)}`,
      )
      return sql`jsonb_build_object(${sql.join(processedEntries, sql`,`)})`
    }

    // Handle primitive values
    return jsonbParam(value)
  }

  return processValue(value) as any
}
