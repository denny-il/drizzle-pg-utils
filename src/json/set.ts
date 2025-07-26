import { isSQLWrapper, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import type { SQL, SQLWrapper } from 'drizzle-orm/sql'
import type {
  SQLJSONDenullify,
  SQLJSONExtractType,
  SQLJSONIsNullish,
  SQLJSONValue,
} from './common.ts'

export type SQLJSONSetMixedValue<T> =
  | SQL<T>
  | (T extends object ? { [K in keyof T]: T[K] | SQL<T[K]> } : T)

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
export function jsonSetPipe<Source extends SQLJSONValue>(
  source: Source,
  ...args: Array<
    (setter: SQLJSONSet<Source, Source>) => SQL<SQLJSONExtractType<Source>>
  >
): SQL<SQLJSONExtractType<Source>> {
  return args.reduce(
    (acc, fn) => {
      const setter = jsonSet(acc)
      return fn(setter as any)
    },
    source as SQL<SQLJSONExtractType<Source>>,
  )
}
