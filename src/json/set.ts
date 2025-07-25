import { isSQLWrapper, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import type { SQL, SQLWrapper } from 'drizzle-orm/sql'
import type {
  SQLJSONDenullify,
  SQLJSONExtractType,
  SQLJSONIsNullish,
  SQLJSONValue,
} from './common.ts'

export type SQLJSONSetMixedValue<T> = T extends any[]
  ? SQL<T> | (T[number] | SQL<T[number]>)[]
  : T extends object
    ? { [K in keyof T]: T[K] | SQL<T[K]> }
    : T | SQL<T>

export type SQLJSONSetFn<Type, Source extends SQLJSONValue> = (
  value: SQLJSONSetMixedValue<SQLJSONDenullify<Type>>,
  createMissing?: boolean,
) => SQL<SQLJSONExtractType<Source>>

export type SQLJSONSet<
  Source extends SQLJSONValue,
  Value extends SQLJSONValue,
  Type extends SQLJSONExtractType<Value> = SQLJSONExtractType<Value>,
  ObjectType extends SQLJSONDenullify<Type> = SQLJSONDenullify<Type>,
  IsNullish extends boolean = SQLJSONIsNullish<Type> extends true
    ? true
    : Value extends AnyPgColumn
      ? Value['_']['notNull'] extends true
        ? false
        : true
      : false,
  IsObject extends ObjectType extends object
    ? true
    : false = ObjectType extends object ? true : false,
> = (IsObject extends false
  ? {}
  : {
      [K in keyof ObjectType]-?: SQLJSONSet<
        Source,
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
  $set: SQLJSONSetFn<Type, Source>
}

export function jsonSet<Source extends SQLJSONValue>(
  source: Source,
): SQLJSONSet<Source, Source> {
  function buildSet(path: string[], value: any, createMissing = true) {
    const valueSQL = processValue(value)
    if (path.length === 0) return valueSQL
    const pathArray = sql`array[${sql.join(
      path.map((p) => sql`${p}`.inlineParams()),
      sql`,`,
    )}]::text[]`
    return sql`jsonb_set(${source}, ${pathArray}, ${valueSQL}, ${sql`${createMissing}`.inlineParams()})`
  }

  function processValue(value: any): SQLWrapper {
    // If it's already an SQL object, return as-is
    if (isSQLWrapper(value)) return value

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

  function createValue(path: string[], property?: string) {
    const pathArr = property ? [...path, property] : path
    return createProxy(pathArr)
  }

  function createProxy(path: string[] = []): SQLJSONSet<Source, Source> {
    return new Proxy(Object.create(null), {
      get(_, property) {
        if (typeof property === 'symbol')
          throw new TypeError('Symbols are not supported in JSON paths')
        if (property === '$set') {
          return (value: any, createMissing = true) => {
            return buildSet(path, value, createMissing)
          }
        }
        return createValue(path, property)
      },
    })
  }

  return createValue([]) as any
}
