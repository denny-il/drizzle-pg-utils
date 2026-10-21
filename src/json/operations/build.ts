import {
  is,
  isSQLWrapper,
  type SQL,
  type SQLWrapper,
  Param,
  Placeholder,
  sql,
} from 'drizzle-orm'
import { jsonbParam } from '../param.ts'

export type SQLJSONBuildMixedPrimitiveType =
  | string
  | number
  | boolean
  | null
  | SQL<string | number | boolean | null>

export type SQLJSONBuildMixedArrayType =
  | Array<SQLJSONBuildMixedType>
  | SQL<Array<SQLJSONBuildMixedType>>

export type SQLJSONBuildMixedObjectType =
  | { [key: string]: SQLJSONBuildMixedType }
  | SQL<{ [key: string]: SQLJSONBuildMixedType }>

export type SQLJSONBuildMixedType =
  | SQLJSONBuildMixedPrimitiveType
  | SQLJSONBuildMixedArrayType
  | SQLJSONBuildMixedObjectType

export type SQLJSONBuildUnwrapType<T extends SQLJSONBuildMixedType> =
  T extends SQL<infer U>
    ? U
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
