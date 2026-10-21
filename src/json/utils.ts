import { isSQLWrapper, type SQL, sql } from 'drizzle-orm'

import { jsonBuild } from './operations/build.ts'
import { jsonbParam } from './param.ts'
import { jsonSource } from './source.ts'
import type { SQLJSONExtractType, SQLJSONValue } from './types.ts'

export const normalizeNullish = <T>(value: SQLJSONValue<T>): SQL<T> => {
  return sql<T>`coalesce(${jsonSource(value)}, 'null'::jsonb)`
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
  if (path.length === 0) return sql`${jsonSource(source)}`
  return sql`jsonb_extract_path(${jsonSource(source)}, ${jsonPathArgs(path)})`
}

export const jsonExtractText = (
  source: SQLJSONValue,
  path: string[],
): SQL<string> => {
  if (path.length === 0) return sql<string>`(${jsonSource(source)} #>> '{}')`
  return sql<string>`jsonb_extract_path_text(${jsonSource(source)}, ${jsonPathArgs(path)})`
}

/**
 * Builds the new value for `jsonb_set`. `jsonb_set` is strict, so a SQL value
 * that evaluates to NULL would turn the whole document into SQL NULL; coalesce
 * it to JSON null so only the target path is affected.
 */
export const jsonSetValue = (value: unknown): SQL => {
  const built = jsonBuild(value as any)
  return isSQLWrapper(value) ? sql`coalesce(${built}, 'null'::jsonb)` : built
}

export const jsonSetPath = (
  source: SQLJSONValue,
  path: string[],
  value: unknown,
  createMissing = true,
  rootError = 'Cannot set default value at root level',
) => {
  if (path.length === 0) throw new Error(rootError)
  return sql`jsonb_set(${jsonSource(source)}, ${jsonPathArray(path)}, ${jsonSetValue(
    value,
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
  const currentValueSQL = jsonExtract(source, path)
  return sql`jsonb_set(coalesce(nullif(${jsonSource(source)}, 'null'::jsonb), '{}'::jsonb), ${jsonPathArray(
    path,
  )}, coalesce(nullif(${currentValueSQL}, 'null'::jsonb), ${jsonSetValue(
    value,
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
    // Group the value: `@>` binds as tightly as `||`, so `a || b` would
    // otherwise parse as `(source @> a) || b`.
    return sql<boolean>`${jsonSource(source)} @> (${jsonSource(value)})`
  }

  return sql<boolean>`${jsonSource(source)} @> ${jsonbParam(jsonWrapPath(path, value))}`
}

export const jsonWithSourceAlias = <Source extends SQLJSONValue>(
  source: Source,
  build: (sourceRef: SQL<SQLJSONExtractType<Source>>) => SQL,
) => {
  const sourceRef = sql<SQLJSONExtractType<Source>>`__json_ref_source.value`
  return sql`(with __json_ref_source as (select ${jsonSource(source)} as value) select ${build(
    sourceRef,
  )} from __json_ref_source)`
}
