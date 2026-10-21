import {
  is,
  isSQLWrapper,
  noopEncoder,
  Param,
  Placeholder,
  SQL,
  type SQLWrapper,
  StringChunk,
  sql,
} from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

import { jsonbParam } from '../param.ts'
import { jsonSource } from '../source.ts'

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
  function processSQL(value: SQLWrapper): SQLWrapper {
    const expression = jsonSource(value)
    if (expression !== value) return processSQL(expression)

    if (is(value, Param) || is(value, Placeholder)) {
      const param = is(value, Param) ? value : new Param(value)
      if (is(param.value, SQL)) return processSQL(param.value)
      if (is(param.value, Placeholder)) {
        // Prepared values are unknown until execution. Encode them to JSON
        // text at bind time so postgres-js cannot serialize them twice.
        const encode = (input: unknown) => {
          const mapped =
            input === null ? null : param.encoder.mapToDriverValue(input)
          return JSON.stringify(mapped === undefined ? null : mapped)
        }
        return sql`coalesce(${sql.param(param.value, { mapToDriverValue: encode })}::text::jsonb, 'null'::jsonb)`
      }
      const mapped =
        param.value === null || param.encoder === noopEncoder
          ? param.value
          : param.encoder.mapToDriverValue(param.value)
      if (isSQLWrapper(mapped)) return processSQL(mapped)
      return jsonbParam(mapped)
    }

    // `sql\`${value}\`` is a single bound value chunk. PostgreSQL cannot
    // infer an untyped parameter inside JSON builders, and a jsonb-typed
    // parameter would parse the string `'42'` as the number 42, so encode the
    // JS value as JSON. Other single chunks (e.g. from `sql.join`) unwrap.
    const queryChunks = (value as { queryChunks?: unknown[] }).queryChunks
    if (Array.isArray(queryChunks) && queryChunks.length === 1) {
      const [chunk] = queryChunks
      if (!isSQLWrapper(chunk) && !is(chunk, StringChunk))
        return jsonbParam(chunk)
      if (
        is(chunk, SQL) ||
        is(chunk, SQL.Aliased) ||
        is(chunk, Param) ||
        is(chunk, Placeholder)
      )
        return processSQL(chunk)
    }
    return sql`to_jsonb(${value})`
  }

  // Mirror JSON.stringify (used for plain values elsewhere) so Date and
  // Temporal values serialize to strings instead of empty objects: call
  // `toJSON(key)` once per position, so `toJSON() { return this }` is valid
  // and does not recurse.
  function toJSONValue(value: any, key: string) {
    if (isSQLWrapper(value) || typeof value?.toJSON !== 'function') return value
    return value.toJSON(key)
  }

  // Values JSON.stringify drops from objects and turns into null in arrays.
  function isOmitted(value: unknown) {
    return (
      value === undefined ||
      typeof value === 'function' ||
      typeof value === 'symbol'
    )
  }

  // `value` has already had its `toJSON` applied.
  function processValue(value: any): SQLWrapper {
    if (isSQLWrapper(value)) return processSQL(value)

    // Handle arrays with mixed JS/SQL values
    if (Array.isArray(value)) {
      // Array.from visits holes in sparse arrays, which map would skip.
      const processedElements = Array.from(value, (v, index) => {
        const element = toJSONValue(v, String(index))
        return processValue(isOmitted(element) ? null : element)
      })
      return sql`jsonb_build_array(${sql.join(processedElements, sql`,`)})`
    }

    // Handle objects with mixed JS/SQL values
    if (typeof value === 'object' && value !== null) {
      const processedEntries = Object.entries(value)
        .map(([key, val]) => [key, toJSONValue(val, key)] as const)
        .filter(([_, val]) => !isOmitted(val))
        .map(
          ([key, val]) =>
            sql`${sql`${key}`.inlineParams()}, ${processValue(val)}`,
        )
      return sql`jsonb_build_object(${sql.join(processedEntries, sql`,`)})`
    }

    // Handle primitive values
    return jsonbParam(value)
  }

  const root = toJSONValue(value, '')
  return processValue(isOmitted(root) ? null : root) as any
}
