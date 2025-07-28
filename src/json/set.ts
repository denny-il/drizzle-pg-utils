import { sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm/sql'
import { jsonBuild } from './build.ts'
import { jsonCoalesce } from './coalesce.ts'
import {
  normalizeNullish,
  type SQLJSONDenullify,
  type SQLJSONExtractType,
  type SQLJSONIsNullish,
  type SQLJSONValue,
} from './common.ts'

export type SQLJSONSetMixedValue<T> =
  | SQL<T>
  | (T extends object ? { [K in keyof T]: T[K] | SQL<T[K]> } : T)

export type SQLJSONSetFn<Type, Source extends SQLJSONValue> = (
  value: SQLJSONSetMixedValue<SQLJSONDenullify<Type>>,
  createMissing?: boolean,
) => SQL<SQLJSONExtractType<Source>>

export type SQLJSONDefaultFn<Type, Source extends SQLJSONValue> = (
  value: SQLJSONSetMixedValue<SQLJSONDenullify<Type>>,
  createMissing?: boolean,
) => SQLJSONSet<Source, SQL<SQLJSONDenullify<Type>>, false>

export type SQLJSONSet<
  Source extends SQLJSONValue,
  Value extends SQLJSONValue,
  Root extends boolean,
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
> = (Root extends false
  ? {
      $set: SQLJSONSetFn<Type, Source>
    }
  : {}) &
  (IsNullish extends true
    ? IsObject extends true
      ? { $default: SQLJSONDefaultFn<Type, Source> }
      : {}
    : {}) &
  (IsObject extends false
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
          >,
          false
        >
      })

export function jsonSet<Source extends SQLJSONValue<object>>(
  source: Source,
): SQLJSONSet<Source, Source, true> {
  function _jsonSet(source: Source, defPath: string[] = []) {
    function buildSet(path: string[], value: any, createMissing = true) {
      const setValueSQL = jsonBuild(value)
      if (path.length === 0)
        throw new Error('Cannot set default value at root level')
      const pathArray = sql`array[${sql.join(
        path.map((p) => sql`${p}`.inlineParams()),
        sql`,`,
      )}]::text[]`
      return sql`jsonb_set(${source}, ${pathArray}, ${setValueSQL}, ${sql`${createMissing}`.inlineParams()})`
    }

    function buildDefault(path: string[], value: any, createMissing = true) {
      const defaultValueSQL = jsonBuild(value)
      if (path.length === 0)
        throw new Error('Cannot set default value at root level')
      const pathArgs = sql.join(
        path.map((p) => sql`${p}`.inlineParams()),
        sql`,`,
      )
      const pathArray = sql`array[${pathArgs}]::text[]`
      return _jsonSet(
        sql`jsonb_set(${source}, ${pathArray}, ${jsonCoalesce(sql`jsonb_extract_path(${source}, ${pathArgs})`, defaultValueSQL)}, ${sql`${createMissing}`.inlineParams()})` as Source,
        path,
      )
    }

    function createValue(path: string[], property?: string) {
      const pathArr = property ? [...path, property] : path
      return createProxy(pathArr)
    }

    function createProxy(path: string[] = []): SQLJSONSet<Source, Source, any> {
      return new Proxy(Object.create(null), {
        get(_, property) {
          if (typeof property === 'symbol')
            throw new TypeError('Symbols are not supported in JSON paths')
          if (property === '$set') {
            return (value: any, createMissing = true) => {
              return buildSet(path, value, createMissing)
            }
          }
          if (property === '$default') {
            return (value: any, createMissing = true) => {
              return buildDefault(path, value, createMissing)
            }
          }
          return createValue(path, property)
        },
      })
    }
    return createValue(defPath) as any
  }

  return _jsonSet(source)
}

export type SQLJSONPipeFnType<Source extends SQLJSONValue> = (
  setter: SQLJSONSet<Source, Source, true>,
) => SQL<SQLJSONExtractType<Source>>
/**
 * Chains multiple JSONB set operations together. Each operation receives the result of the previous one.
 *
 * @param source - The initial JSONB column or SQL expression
 * @param args - Functions that take a setter and return an SQL expression
 * @returns SQL expression with all updates applied sequentially
 *
 * @example
 * ```typescript
 * // Chain multiple updates
 * const updated = jsonSetPipe(
 *   userData,
 *   (setter) => setter.user.name.$set('Jane'),
 *   (setter) => setter.user.profile.$set({ avatar: 'new.jpg' }),
 *   (setter) => setter.lastLogin.$set('2023-12-01')
 * )
 * ```
 *
 * @example
 * ```typescript
 * // Database updates
 * await db.update(users).set({
 *   profile: jsonSetPipe(
 *     users.profile,
 *     (setter) => setter.name.$set('Updated'),
 *     (setter) => setter.settings.theme.$set('dark')
 *   )
 * }).where(eq(users.id, 1))
 * ```
 */
export function jsonSetPipe<Source extends SQLJSONValue<object>>(
  source: Source,
  ...args: [SQLJSONPipeFnType<Source>, ...SQLJSONPipeFnType<Source>[]]
): SQL<SQLJSONExtractType<Source>> {
  return args.reduce(
    (acc, fn) => {
      const setter = jsonSet(acc)
      return fn(setter as any)
    },
    normalizeNullish(source) as SQL<SQLJSONExtractType<Source>>,
  )
}
