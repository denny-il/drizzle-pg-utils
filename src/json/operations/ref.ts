import { isSQLWrapper, type SQL, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import type {
  SQLJSONDenullify,
  SQLJSONExtractType,
  SQLJSONIsNullish,
  SQLJSONNullify,
  SQLJSONValue,
} from '../types.ts'
import {
  jsonContainsPath,
  jsonDefaultPath,
  jsonExtract,
  jsonExtractText,
  jsonPathArray,
  jsonSetPath,
  jsonWithSourceAlias,
} from '../utils.ts'
import { jsonArrayPush } from './array.ts'
import {
  jsonBuild,
  type SQLJSONBuildMixedType,
  type SQLJSONBuildUnwrapType,
} from './build.ts'
import { jsonCoalesce } from './coalesce.ts'
import type { SQLJSONContainmentValue } from './contains.ts'
import { jsonMerge } from './merge.ts'
import type { SQLJSONSetMixedValue } from './set.ts'

const refDefaultSourceSymbol = Symbol('SQLJSONRefDefaultSource')

type SQLJSONArrayElement<Type> =
  SQLJSONDenullify<Type> extends readonly (infer Element)[] ? Element : never

type SQLJSONRefSetFn<Type, RootSource extends SQLJSONValue> = (
  value: SQLJSONSetMixedValue<SQLJSONDenullify<Type>>,
  createMissing?: boolean,
) => SQL<SQLJSONExtractType<RootSource>>

type SQLJSONRefDefaultFn<Type, RootSource extends SQLJSONValue> = (
  value: SQLJSONSetMixedValue<SQLJSONDenullify<Type>>,
  createMissing?: boolean,
) => SQLJSONDefaultRef<RootSource, SQL<SQLJSONDenullify<Type>>>

type SQLJSONRefPushFn<Type, RootSource extends SQLJSONValue> = (
  ...values: Array<
    SQLJSONArrayElement<Type> | SQLJSONValue<SQLJSONArrayElement<Type>>
  >
) => SQL<SQLJSONExtractType<RootSource>>

type SQLJSONRefMergeFn<RootSource extends SQLJSONValue> = (
  value: SQLJSONBuildMixedType | SQLJSONValue,
) => SQL<SQLJSONExtractType<RootSource>>

type SQLJSONRefCoalesceFn<Type> = <Value extends SQLJSONBuildMixedType>(
  value: Value,
) => SQL<SQLJSONDenullify<Type> | SQLJSONBuildUnwrapType<Value>>

type SQLJSONRefReservedKey =
  | '$value'
  | '$text'
  | '$coalesce'
  | '$merge'
  | '$contains'
  | '$pipe'
  | '$set'
  | '$default'
  | '$push'
  | '$delete'
  | '$key'
  | 'getSQL'
  | 'toString'
  | 'valueOf'

type SQLJSONRefContainsValue<Root extends boolean, ObjectType> =
  | SQLJSONContainmentValue<ObjectType>
  | (Root extends true
      ? SQLJSONValue<SQLJSONContainmentValue<ObjectType>>
      : never)

type SQLJSONRefKeyFn<
  RootSource extends SQLJSONValue,
  CanContain extends boolean,
> = (key: string) => SQLJSONRef<RootSource, SQL<unknown>, false, CanContain>

export type SQLJSONRef<
  RootSource extends SQLJSONValue,
  Value extends SQLJSONValue = RootSource,
  Root extends boolean = true,
  CanContain extends boolean = true,
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
> = {
  getSQL(): SQL<SQLJSONExtractType<Value>>
  shouldOmitSQLParens(): boolean
  $value: SQL<SQLJSONNullify<IsNullish, Type>>
  $text: SQL<SQLJSONNullify<IsNullish, string>>
  $key: SQLJSONRefKeyFn<RootSource, CanContain>
  $coalesce: SQLJSONRefCoalesceFn<Type>
  $merge: SQLJSONRefMergeFn<RootSource>
} & (CanContain extends true
  ? {
      $contains(value: SQLJSONRefContainsValue<Root, ObjectType>): SQL<boolean>
    }
  : {}) &
  (Root extends true
    ? {
        $pipe(
          ...args: [
            SQLJSONRefPipeFn<RootSource>,
            ...SQLJSONRefPipeFn<RootSource>[],
          ]
        ): SQL<SQLJSONExtractType<RootSource>>
      }
    : {}) &
  (Root extends false
    ? {
        $set: SQLJSONRefSetFn<Type, RootSource>
        $delete(): SQL<SQLJSONExtractType<RootSource>>
      }
    : {}) &
  (Root extends false
    ? IsNullish extends true
      ? IsObject extends true
        ? { $default: SQLJSONRefDefaultFn<Type, RootSource> }
        : {}
      : {}
    : {}) &
  (ObjectType extends readonly (infer Element)[]
    ? {
        $push: SQLJSONRefPushFn<Type, RootSource>
        [index: number]: SQLJSONRef<
          RootSource,
          SQL<Element | null>,
          false,
          false
        >
      }
    : IsObject extends false
      ? {}
      : {
          [K in keyof ObjectType as K extends SQLJSONRefReservedKey
            ? never
            : K]-?: SQLJSONRef<
            RootSource,
            SQL<
              | ObjectType[K]
              | (IsNullish extends true
                  ? null
                  : ObjectType extends any[]
                    ? null
                    : never)
            >,
            false,
            CanContain
          >
        })

type SQLJSONDefaultRef<
  RootSource extends SQLJSONValue,
  Value extends SQLJSONValue,
> = SQLJSONRef<RootSource, Value, false> & {
  readonly [refDefaultSourceSymbol]: SQL<SQLJSONExtractType<RootSource>>
}

type SQLJSONRefPipeResult<Source extends SQLJSONValue> =
  | SQL<SQLJSONExtractType<Source>>
  | SQLJSONDefaultRef<Source, SQLJSONValue>

export type SQLJSONRefPipeFn<Source extends SQLJSONValue> = (
  value: SQLJSONRef<Source>,
) => SQLJSONRefPipeResult<Source>

function buildExtract(source: SQLJSONValue, path: string[]) {
  return jsonExtract(source, path)
}

function buildExtractText(source: SQLJSONValue, path: string[]) {
  return jsonExtractText(source, path)
}

function buildSet(
  source: SQLJSONValue,
  path: string[],
  value: unknown,
  createMissing = true,
) {
  return jsonSetPath(
    source,
    path,
    value,
    createMissing,
    'Cannot set value at root level',
  )
}

function buildDefault(
  source: SQLJSONValue,
  path: string[],
  value: unknown,
  createMissing = true,
) {
  return jsonWithSourceAlias(source, (sourceRef) =>
    jsonDefaultPath(sourceRef, path, value, createMissing),
  )
}

function buildContains(
  source: SQLJSONValue,
  path: string[],
  value: unknown,
): SQL<boolean> {
  return jsonContainsPath(source, path, value)
}

function buildPush(source: SQLJSONValue, path: string[], values: unknown[]) {
  if (path.length === 0)
    return jsonArrayPush(buildExtract(source, path) as any, ...(values as any))
  return jsonWithSourceAlias(source, (sourceRef) => {
    const pushed = jsonArrayPush(
      buildExtract(sourceRef, path) as any,
      ...(values as any),
    )
    return sql`jsonb_set(${sourceRef}, ${jsonPathArray(path)}, ${pushed}, true)`
  })
}

function buildDelete(source: SQLJSONValue, path: string[]) {
  if (path.length === 0) throw new Error('Cannot delete root JSON value')
  return sql`${source} #- ${jsonPathArray(path)}`
}

function buildMerge(source: SQLJSONValue, path: string[], value: unknown) {
  const right = isSQLWrapper(value) ? value : jsonBuild(value as any)
  if (path.length === 0) return jsonMerge(source, right as any)
  return jsonWithSourceAlias(source, (sourceRef) => {
    const current = sql`coalesce(nullif(${buildExtract(
      sourceRef,
      path,
    )}, 'null'::jsonb), '{}'::jsonb)`
    const merged = jsonMerge(current as any, right as any)
    return sql`jsonb_set(${sourceRef}, ${jsonPathArray(path)}, ${merged}, true)`
  })
}

function buildCoalesce(source: SQLJSONValue, path: string[], value: unknown) {
  return jsonCoalesce(buildExtract(source, path) as any, value as any)
}

export function jsonRef<Source extends SQLJSONValue>(
  source: Source,
): SQLJSONRef<Source> {
  function createProxy(
    activeSource: SQLJSONValue,
    path: string[] = [],
    pipeResult = false,
  ): SQLJSONRef<Source> {
    return new Proxy(Object.create(null), {
      get(_, property) {
        if (property === refDefaultSourceSymbol)
          return pipeResult ? activeSource : undefined
        if (typeof property === 'symbol') return undefined

        switch (property) {
          case 'getSQL':
            return () =>
              pipeResult ? activeSource : buildExtract(activeSource, path)
          case 'shouldOmitSQLParens':
            return () => true
          case 'toString':
            return () => '[object SQLJSONRef]'
          case 'valueOf':
            return () =>
              pipeResult ? activeSource : buildExtract(activeSource, path)
          case '$value':
            return buildExtract(activeSource, path)
          case '$text':
            return buildExtractText(activeSource, path)
          case '$key':
            return (key: string) => createProxy(activeSource, [...path, key])
          case '$pipe':
            if (path.length > 0)
              throw new Error('JSON pipe is only supported at the root path')
            return (
              ...args: [SQLJSONRefPipeFn<Source>, ...SQLJSONRefPipeFn<Source>[]]
            ) => jsonRefPipe(activeSource as Source, ...args)
          case '$merge':
            return (value: unknown) => buildMerge(activeSource, path, value)
          case '$coalesce':
            return (value: unknown) => buildCoalesce(activeSource, path, value)
          case '$contains':
            return (value: unknown) => buildContains(activeSource, path, value)
          case '$set':
            return (value: unknown, createMissing = true) =>
              buildSet(activeSource, path, value, createMissing)
          case '$default':
            return (value: unknown, createMissing = true) =>
              createProxy(
                buildDefault(activeSource, path, value, createMissing),
                path,
                true,
              )
          case '$push':
            return (...values: unknown[]) =>
              buildPush(activeSource, path, values)
          case '$delete':
            return () => buildDelete(activeSource, path)
          default:
            return createProxy(activeSource, [...path, property])
        }
      },
    }) as SQLJSONRef<Source>
  }

  return createProxy(source)
}

export function jsonRefPipe<Source extends SQLJSONValue>(
  source: Source,
  ...args: [SQLJSONRefPipeFn<Source>, ...SQLJSONRefPipeFn<Source>[]]
): SQL<SQLJSONExtractType<Source>> {
  return args.reduce(
    (acc, fn) => {
      const result = fn(jsonRef(acc) as any)
      if (isSQLWrapper(result))
        return result.getSQL() as SQL<SQLJSONExtractType<Source>>
      throw new Error(
        'JSON pipe steps must return a JSON SQL expression or a $default continuation',
      )
    },
    source as SQL<SQLJSONExtractType<Source>>,
  )
}
