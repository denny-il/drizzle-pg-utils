import { isSQLWrapper, type SQL, type SQLWrapper, sql } from 'drizzle-orm'

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
  function isEmptyStringChunk(chunk: unknown) {
    const value = (chunk as { value?: unknown }).value
    return Array.isArray(value) && value.length === 1 && value[0] === ''
  }

  function isBareParamSQL(value: SQLWrapper) {
    const queryChunks = (value as { queryChunks?: unknown[] }).queryChunks
    return (
      Array.isArray(queryChunks) &&
      queryChunks.length === 3 &&
      isEmptyStringChunk(queryChunks[0]) &&
      isEmptyStringChunk(queryChunks[2])
    )
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
    return sql`${JSON.stringify(value)}::jsonb`
  }

  return processValue(value) as any
}
