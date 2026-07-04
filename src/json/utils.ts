import { isSQLWrapper, type SQL, sql } from 'drizzle-orm'
import { jsonBuild } from './operations/build.ts'
import type {
  SQLJSONExtractType,
  SQLJSONIsNullish,
  SQLJSONValue,
} from './types.ts'

export const normalizeNullish = <T>(
  value: SQLJSONValue<T>,
): SQLJSONIsNullish<T> extends true ? SQL<T> : never => {
  return sql<T>`coalesce(${value}, 'null'::jsonb)` as any
}

export const jsonPathArgs = (path: string[]) => {
  return sql.join(
    path.map((segment) => sql`${segment}`.inlineParams()),
    sql`,`,
  )
}

export const jsonPathArray = (path: string[]) => {
  return sql`array[${jsonPathArgs(path)}]::text[]`
}

export const jsonExtract = (source: SQLJSONValue, path: string[]) => {
  if (path.length === 0) return sql`${source}`
  return sql`jsonb_extract_path(${source}, ${jsonPathArgs(path)})`
}

export const jsonExtractText = (
  source: SQLJSONValue,
  path: string[],
): SQL<string> => {
  if (path.length === 0) return sql<string>`(${source} #>> '{}')`
  return sql<string>`jsonb_extract_path_text(${source}, ${jsonPathArgs(path)})`
}

export const jsonSetPath = (
  source: SQLJSONValue,
  path: string[],
  value: unknown,
  createMissing = true,
  rootError = 'Cannot set default value at root level',
) => {
  if (path.length === 0) throw new Error(rootError)
  return sql`jsonb_set(${source}, ${jsonPathArray(path)}, ${jsonBuild(
    value as any,
  )}, ${sql`${!!createMissing}`.inlineParams()})`
}

export const jsonDefaultPath = (
  source: SQLJSONValue,
  path: string[],
  value: unknown,
  createMissing = true,
) => {
  if (path.length === 0)
    throw new Error('Cannot set default value at root level')
  const pathArgs = jsonPathArgs(path)
  const currentValueSQL = sql`jsonb_extract_path(${source}, ${pathArgs})`
  return sql`jsonb_set(coalesce(nullif(${source}, 'null'::jsonb), '{}'::jsonb), ${jsonPathArray(
    path,
  )}, coalesce(nullif(${currentValueSQL}, 'null'::jsonb), ${jsonBuild(
    value as any,
  )}), ${sql`${!!createMissing}`.inlineParams()})`
}

export const jsonWrapPath = (path: string[], value: unknown) => {
  return path.reduceRight<unknown>(
    (acc, segment) => ({ [segment]: acc }),
    value,
  )
}

export const jsonContainsPath = (
  source: SQLJSONValue,
  path: string[],
  value: unknown,
): SQL<boolean> => {
  if (isSQLWrapper(value)) {
    if (path.length > 0)
      throw new Error(
        'SQL containment values are only supported at the root path',
      )
    return sql<boolean>`${source} @> ${value}`
  }

  return sql<boolean>`${source} @> ${sql`${JSON.stringify(
    jsonWrapPath(path, value),
  )}::jsonb`}`
}

export const jsonWithSourceAlias = <Source extends SQLJSONValue>(
  source: Source,
  build: (sourceRef: SQL<SQLJSONExtractType<Source>>) => SQL,
) => {
  const sourceRef = sql<SQLJSONExtractType<Source>>`__json_ref_source.value`
  return sql`(with __json_ref_source as (select ${source} as value) select ${build(
    sourceRef,
  )} from __json_ref_source)`
}
