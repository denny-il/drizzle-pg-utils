import { sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm/sql'
import type {
  SQLJSONDenullify,
  SQLJSONExtractType,
  SQLJSONIsNullish,
  SQLJSONNullify,
  SQLJSONValue,
} from './common.ts'

export type SQLJSONAccess<
  Source extends SQLJSONValue,
  Type extends SQLJSONExtractType<Source> = SQLJSONExtractType<Source>,
  ObjectType extends SQLJSONDenullify<Type> = SQLJSONDenullify<Type>,
  IsNullish extends boolean = SQLJSONIsNullish<Type> extends true
    ? true
    : Source extends AnyPgColumn
      ? Source['_']['notNull'] extends true
        ? false
        : true
      : false,
  IsObject extends ObjectType extends object
    ? true
    : false = ObjectType extends object ? true : false,
> = (IsObject extends false
  ? {}
  : {
      [K in keyof ObjectType]-?: SQLJSONAccess<
        SQL<
          | ObjectType[K]
          | (IsNullish extends true
              ? null
              : ObjectType extends any[]
                ? null
                : never)
        >
      >
    }) & {
  $value: SQL<SQLJSONNullify<IsNullish, Type>>
  $path: SQL<SQLJSONNullify<IsNullish, Type>>
}

export function jsonAccess<Source extends SQLJSONValue>(
  source: Source,
): SQLJSONAccess<Source> {
  function buildPathArgs(path: string[]) {
    return sql.join(path, sql`,`)
  }

  function buildPath(path: string[]) {
    if (path.length === 0) return sql`${source}`
    return sql`jsonb_extract_path(${source}, ${buildPathArgs(path)})`.inlineParams()
  }

  function buildValue(path: string[], property?: string) {
    if (!property)
      return sql`jsonb_extract_path_text(${source}, ${buildPathArgs(path)})`.inlineParams()
    return sql`jsonb_extract_path_text(${buildPath(path)}, ${buildPathArgs(path)}, ${property})`.inlineParams()
  }

  function createValue(path: string[], property?: string) {
    const pathArr = property ? [...path, property] : path
    return createProxy(pathArr)
  }

  function createProxy(path: string[] = []) {
    return new Proxy(Object.create(null), {
      get(_, property) {
        if (typeof property === 'symbol')
          throw new TypeError('Symbols are not supported in JSON paths')
        if (property === '$value') {
          return buildValue(path)
        }
        if (property === '$path') {
          return buildPath(path)
        }
        return createValue(path, property)
      },
    })
  }

  return createValue([]) as any
}
