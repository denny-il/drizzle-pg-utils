import { type SQL, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

import { jsonSource } from '../source.ts'
import type {
  SQLJSONExtractType,
  SQLJSONIsNullish,
  SQLJSONValue,
} from '../types.ts'

type Scalar = string | number | boolean | null
type Present<T> = Exclude<T, undefined>
type Defined<T> = NonNullable<T>
type IsUnknown<T> = unknown extends T ? true : false
type HasArray<T> = [Extract<Defined<T>, readonly unknown[]>] extends [never]
  ? false
  : true
type IsArray<T> = [Defined<T>] extends [never]
  ? false
  : [Defined<T>] extends [readonly unknown[]]
    ? true
    : false
type IsObject<T> = [Defined<T>] extends [never]
  ? false
  : [Defined<T>] extends [object]
    ? HasArray<T> extends true
      ? false
      : true
    : false
type ArrayElement<T> = Defined<T> extends readonly (infer E)[] ? E : never
// Lax mode wraps a JSON `null` in place of an array, so `[*]` and `[0]` yield it.
type ArrayItem<T> = Present<ArrayElement<T>> | (null extends T ? null : never)

// Numeric-looking keys would compile to array subscripts, and `$`-prefixed
// names are helpers, so both need `$key(...)`.
type SQLJSONPathReservedKey =
  | `$${string}`
  | `${number}`
  | 'getSQL'
  | 'shouldOmitSQLParens'
  | 'then'
  | 'toJSON'
  | 'toString'
  | 'valueOf'

// Index-signature keys (`Record<string, V>`) are left to `$key(...)`: a
// string index would also claim helper names such as `$each`.
type ObjectKeys<O> = {
  [K in Extract<keyof O, string>]: string extends K
    ? never
    : K extends SQLJSONPathReservedKey
      ? never
      : K
}[Extract<keyof O, string>]
type ObjectValues<O> = O extends unknown ? Present<O[keyof O]> : never
type ObjectMember<O, K extends string> = K extends keyof O
  ? Present<O[K]>
  : unknown

/**
 * An item yielded by `$entries` (`.keyvalue()`). `id` identifies the object
 * the entry came from, not the entry itself.
 */
export type SQLJSONPathEntry<O> =
  IsUnknown<O> extends true
    ? { key: string; value: unknown; id: number }
    : O extends unknown
      ? {
          // PostgreSQL object keys are text, so numeric TS keys come back as strings.
          [K in Extract<keyof O, string | number>]: {
            key: `${K}`
            value: Present<O[K]>
            id: number
          }
        }[Extract<keyof O, string | number>]
      : never

// `$match` accepts scalar keys of any union member, so a discriminant can be
// matched together with fields only that member has.
type MatchUnionKeys<O> = O extends unknown ? ObjectKeys<O> : never
type MatchValue<O, K> = O extends unknown
  ? K extends keyof O
    ? Present<O[K]>
    : never
  : never
type MatchKeys<O> = {
  [K in MatchUnionKeys<O>]: [MatchValue<O, K>] extends [never]
    ? never
    : [MatchValue<O, K>] extends [Scalar]
      ? K
      : never
}[MatchUnionKeys<O>]

type MatchShape<O> = { [K in MatchKeys<O>]?: MatchValue<O, K> }

type MatchArgument<O, M> = keyof M extends never
  ? never
  : M & Record<Exclude<keyof M, MatchKeys<O>>, never>

// Keeps the union members that can hold every matched value, so a literal
// discriminant narrows the node to that member. Overlap, not assignability,
// keeps every member a widened value (`kind: E['kind']`) might still match.
type Overlaps<A, B> = [Extract<A, B> | Extract<B, A>] extends [never]
  ? false
  : true
type MatchNarrow<T, M> = T extends object
  ? {
      // An optional matcher field may be absent, so it cannot rule a member out.
      [K in keyof M]-?: {} extends Pick<M, K>
        ? true
        : K extends keyof T
          ? Overlaps<M[K], T[K]>
          : false
    }[keyof M] extends true
    ? T
    : never
  : never

type CanFilter<T> =
  IsUnknown<T> extends true ? true : HasArray<T> extends true ? false : true

declare const predicateBrand: unique symbol

/**
 * A condition built inside a `$filter(...)` callback. It is only valid in the
 * callback that created it, because `@` names a different item in each one.
 */
export interface SQLJSONPathPredicate {
  readonly [predicateBrand]: true
}

/**
 * Combinators passed to `$filter(...)` callbacks. `undefined` operands are
 * skipped, so optional conditions can be written inline; when nothing is
 * left, the result is `undefined` and the filter is omitted.
 */
export type SQLJSONPathPredicates = {
  and(
    ...predicates: Array<SQLJSONPathPredicate | undefined>
  ): SQLJSONPathPredicate | undefined
  or(
    ...predicates: Array<SQLJSONPathPredicate | undefined>
  ): SQLJSONPathPredicate | undefined
  not(predicate: SQLJSONPathPredicate): SQLJSONPathPredicate
  not(predicate: undefined): undefined
  not(
    predicate: SQLJSONPathPredicate | undefined,
  ): SQLJSONPathPredicate | undefined
}

type SQLJSONPathFilterFn<T> = (
  node: SQLJSONPathFilter<T>,
  p: SQLJSONPathPredicates,
) => SQLJSONPathPredicate | undefined

type EqValue<T> = IsUnknown<T> extends true ? Scalar : Extract<T, Scalar>
type OrderValue<T> =
  IsUnknown<T> extends true
    ? number | string
    :
        | ([Extract<T, number>] extends [never] ? never : number)
        | ([Extract<T, string>] extends [never] ? never : string)
type StringValue<T> = IsUnknown<T> extends true ? string : Extract<T, string>

type FilterPredicates<T> = {
  /** `exists(@...)`: the path yields at least one item, JSON `null` included. */
  readonly $exists: SQLJSONPathPredicate
  /** `@... == null`: the value is present and JSON `null`. */
  readonly $isNull: SQLJSONPathPredicate
} & ([EqValue<T>] extends [never]
  ? {}
  : {
      $eq(value: EqValue<T>): SQLJSONPathPredicate
      $ne(value: EqValue<T>): SQLJSONPathPredicate
      $in(values: readonly EqValue<T>[]): SQLJSONPathPredicate
    }) &
  ([OrderValue<T>] extends [never]
    ? {}
    : {
        $lt(value: OrderValue<T>): SQLJSONPathPredicate
        $lte(value: OrderValue<T>): SQLJSONPathPredicate
        $gt(value: OrderValue<T>): SQLJSONPathPredicate
        $gte(value: OrderValue<T>): SQLJSONPathPredicate
      }) &
  ([StringValue<T>] extends [never]
    ? {}
    : {
        $startsWith(prefix: string): SQLJSONPathPredicate
        /** POSIX regex via `like_regex`; `flags` combines `i`, `m`, `s`, `q`. */
        $regex(pattern: string, flags?: string): SQLJSONPathPredicate
      })

type FilterNavigation<T> =
  IsUnknown<T> extends true
    ? {
        readonly $each: SQLJSONPathFilter<unknown>
        readonly $values: SQLJSONPathFilter<unknown>
        readonly $entries: SQLJSONPathFilter<SQLJSONPathEntry<unknown>>
        $key(key: string): SQLJSONPathFilter<unknown>
      }
    : IsArray<T> extends true
      ? {
          readonly $each: SQLJSONPathFilter<ArrayItem<T>>
          readonly [index: number]: SQLJSONPathFilter<ArrayItem<T>>
        }
      : IsObject<T> extends true
        ? {
            readonly $values: SQLJSONPathFilter<ObjectValues<Defined<T>>>
            readonly $entries: SQLJSONPathFilter<SQLJSONPathEntry<Defined<T>>>
            $key<K extends string>(
              key: K,
            ): SQLJSONPathFilter<ObjectMember<Defined<T>, K>>
          } & {
            readonly [K in ObjectKeys<Defined<T>>]: SQLJSONPathFilter<
              Present<Defined<T>[K]>
            >
          }
        : {}

/**
 * A path relative to the item a `$filter(...)` callback tests (`@`). It builds
 * predicates; navigation and nested `$filter(...)` stay relative to `@`.
 */
export type SQLJSONPathFilter<T> = FilterPredicates<T> &
  FilterNavigation<T> &
  (CanFilter<T> extends true
    ? { $filter(fn: SQLJSONPathFilterFn<T>): SQLJSONPathFilter<T> }
    : {}) &
  (IsObject<T> extends true
    ? {
        $match<const M extends MatchShape<Defined<T>>>(
          shape: MatchArgument<Defined<T>, M>,
        ): SQLJSONPathFilter<MatchNarrow<T, M>>
      }
    : {})

type PathNavigation<T, Nullable extends boolean> =
  IsUnknown<T> extends true
    ? {
        readonly $each: SQLJSONPath<unknown, Nullable>
        readonly $values: SQLJSONPath<unknown, Nullable>
        readonly $entries: SQLJSONPath<SQLJSONPathEntry<unknown>, Nullable>
        $key(key: string): SQLJSONPath<unknown, Nullable>
      }
    : IsArray<T> extends true
      ? {
          readonly $each: SQLJSONPath<ArrayItem<T>, Nullable>
          readonly [index: number]: SQLJSONPath<ArrayItem<T>, Nullable>
        }
      : IsObject<T> extends true
        ? {
            readonly $values: SQLJSONPath<ObjectValues<Defined<T>>, Nullable>
            readonly $entries: SQLJSONPath<
              SQLJSONPathEntry<Defined<T>>,
              Nullable
            >
            $key<K extends string>(
              key: K,
            ): SQLJSONPath<ObjectMember<Defined<T>, K>, Nullable>
          } & {
            readonly [K in ObjectKeys<Defined<T>>]: SQLJSONPath<
              Present<Defined<T>[K]>,
              Nullable
            >
          }
        : {}

/**
 * A typed, read-only SQL/JSON path over a JSONB source, evaluated in lax mode.
 * `T` is the type of one item the path yields; `Nullable` tracks whether the
 * source itself can be SQL `NULL`.
 */
export type SQLJSONPath<T, Nullable extends boolean = true> = {
  /** `source @? path`: whether the path yields any item. GIN-indexable. */
  readonly $exists: SQL<boolean | (Nullable extends true ? null : never)>
  /** `jsonb_path_query_array(...)`: every yielded item, `[]` when none. */
  readonly $query: SQL<Present<T>[] | (Nullable extends true ? null : never)>
  /** `jsonb_path_query_first(...)`: the first yielded item, or SQL `NULL`. */
  readonly $first: SQL<Present<T> | null>
} & PathNavigation<T, Nullable> &
  (CanFilter<T> extends true
    ? {
        $filter(fn: SQLJSONPathFilterFn<T>): SQLJSONPath<T, Nullable>
      }
    : {}) &
  (IsObject<T> extends true
    ? {
        $match<const M extends MatchShape<Defined<T>>>(
          shape: MatchArgument<Defined<T>, M>,
        ): SQLJSONPath<MatchNarrow<T, M>, Nullable>
      }
    : {})

export type SQLJSONPathOf<Source extends SQLJSONValue> = SQLJSONPath<
  SQLJSONExtractType<Source>,
  SQLJSONIsNullish<SQLJSONExtractType<Source>> extends true
    ? true
    : Source extends AnyPgColumn
      ? Source['_']['notNull'] extends true
        ? false
        : true
      : false
>

/** One `$filter(...)` callback; `@` means a different item in each. */
class PathScope {}

class PathPredicate {
  constructor(
    readonly text: string,
    readonly scope: PathScope,
  ) {}
}

const maxArrayIndex = 2147483647

function pathLiteral(value: unknown): string {
  if (value === null || typeof value === 'boolean') return String(value)
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new TypeError('JSON path numbers must be finite')
    return JSON.stringify(value)
  }
  throw new TypeError(
    'JSON path values must be strings, finite numbers, booleans, or null',
  )
}

function pathOrderLiteral(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number')
    throw new TypeError('JSON path comparisons take a string or a number')
  return pathLiteral(value)
}

function pathString(value: unknown, name: string): string {
  if (typeof value !== 'string')
    throw new TypeError(`JSON path ${name} must be a string`)
  return JSON.stringify(value)
}

function pathKey(key: unknown): string {
  return `.${pathString(key, 'keys')}`
}

// A proxy can't tell `node[0]` from `node['0']`, so canonical integer names
// are array subscripts; numeric object keys go through `$key(...)`.
function pathSegment(property: string): string {
  const index = Number(property)
  if (property.trim() !== '' && !Number.isNaN(index)) {
    if (!/^(?:0|[1-9]\d*)$/.test(property) || index > maxArrayIndex)
      throw new RangeError(
        `JSON path array index ${property} must be an integer from 0 to ${maxArrayIndex}; use $key(...) for numeric object keys`,
      )
    return `[${property}]`
  }
  return pathKey(property)
}

function assertPredicate(
  value: unknown,
  scope: PathScope,
): asserts value is PathPredicate {
  if (!(value instanceof PathPredicate))
    throw new TypeError(
      'JSON path filters must return a predicate built from the filter node, e.g. node.score.$lt(1)',
    )
  if (value.scope !== scope)
    throw new Error(
      'JSON path predicate used outside the $filter callback that created it',
    )
}

function createPredicates(scope: PathScope): SQLJSONPathPredicates {
  const combine = (operator: '&&' | '||', values: unknown[]) => {
    const present = values.filter((value) => value !== undefined)
    for (const value of present) assertPredicate(value, scope)
    const predicates = present as PathPredicate[]
    if (predicates.length === 0) return undefined
    if (predicates.length === 1) return predicates[0]
    return new PathPredicate(
      predicates
        .map((predicate) => `(${predicate.text})`)
        .join(` ${operator} `),
      scope,
    )
  }

  return {
    and: (...values: unknown[]) => combine('&&', values),
    or: (...values: unknown[]) => combine('||', values),
    not: (value: unknown) => {
      if (value === undefined) return undefined
      assertPredicate(value, scope)
      return new PathPredicate(`!(${value.text})`, scope)
    },
  } as SQLJSONPathPredicates
}

function buildFilter(path: string, fn: unknown): string {
  if (typeof fn !== 'function')
    throw new TypeError('$filter(...) takes a callback')
  const scope = new PathScope()
  const predicate = fn(createFilterNode(scope, '@'), createPredicates(scope))
  if (predicate === undefined) return path
  assertPredicate(predicate, scope)
  return `${path} ? (${predicate.text})`
}

function buildMatch(path: string, shape: unknown): string {
  if (typeof shape !== 'object' || shape === null || Array.isArray(shape))
    throw new TypeError('$match(...) takes an object of scalar values')
  const conditions = Object.entries(shape).map(([key, value]) => {
    if (value === undefined)
      throw new TypeError(`$match(...) value for "${key}" is undefined`)
    return `@${pathKey(key)} == ${pathLiteral(value)}`
  })
  if (conditions.length === 0)
    throw new TypeError('$match(...) needs at least one key')
  const condition =
    conditions.length === 1
      ? conditions[0]
      : conditions.map((condition) => `(${condition})`).join(' && ')
  return `${path} ? (${condition})`
}

// Properties shared by path and filter nodes: navigation and filtering.
// Returns `undefined` for properties the caller should handle itself.
function navigate(
  path: string,
  property: string,
  next: (path: string) => unknown,
): unknown {
  switch (property) {
    case '$each':
      return next(`${path}[*]`)
    case '$values':
      return next(`${path}.*`)
    case '$entries':
      // `.keyvalue()` errors on non-objects even in lax mode (e.g. a JSON
      // null map), so skip them like the lax accessors do.
      return next(`${path} ? (@.type() == "object").keyvalue()`)
    case '$key':
      return (key: unknown) => next(`${path}${pathKey(key)}`)
    case '$filter':
      return (fn: unknown) => next(buildFilter(path, fn))
    case '$match':
      return (shape: unknown) => next(buildMatch(path, shape))
    case 'getSQL':
    case 'shouldOmitSQLParens':
    case 'then':
    case 'toJSON':
    case 'valueOf':
      // Not SQL and not thenable: a node must end in a terminal.
      return undefined
    case 'toString':
      return () => '[object SQLJSONPath]'
    default:
      return next(`${path}${pathSegment(property)}`)
  }
}

function createFilterNode(scope: PathScope, path: string): unknown {
  const predicate = (text: string) => new PathPredicate(text, scope)
  const compare = (operator: string) => (value: unknown) =>
    predicate(`${path} ${operator} ${pathLiteral(value)}`)
  const order = (operator: string) => (value: unknown) =>
    predicate(`${path} ${operator} ${pathOrderLiteral(value)}`)

  return new Proxy(Object.create(null), {
    get(_, property) {
      if (typeof property === 'symbol') return undefined
      switch (property) {
        case '$exists':
          return predicate(`exists(${path})`)
        case '$isNull':
          return predicate(`${path} == null`)
        case '$eq':
          return compare('==')
        case '$ne':
          return compare('!=')
        case '$lt':
          return order('<')
        case '$lte':
          return order('<=')
        case '$gt':
          return order('>')
        case '$gte':
          return order('>=')
        case '$in':
          return (values: unknown) => {
            if (!Array.isArray(values))
              throw new TypeError('$in(...) takes an array of values')
            // jsonpath has no boolean literals as predicates, and no `in`.
            if (values.length === 0) return predicate('1 == 0')
            if (values.length === 1)
              return predicate(`${path} == ${pathLiteral(values[0])}`)
            return predicate(
              values
                .map((value) => `(${path} == ${pathLiteral(value)})`)
                .join(' || '),
            )
          }
        case '$startsWith':
          return (prefix: unknown) =>
            predicate(`${path} starts with ${pathString(prefix, 'prefixes')}`)
        case '$regex':
          return (pattern: unknown, flags?: unknown) => {
            const regex = `${path} like_regex ${pathString(pattern, 'patterns')}`
            if (flags === undefined || flags === '') return predicate(regex)
            // PostgreSQL rejects `x` as not implemented.
            if (typeof flags !== 'string' || !/^[imsq]+$/.test(flags))
              throw new TypeError(
                'JSON path regex flags must be made of i, m, s, and q',
              )
            return predicate(`${regex} flag ${JSON.stringify(flags)}`)
          }
        default:
          return navigate(path, property, (next) =>
            createFilterNode(scope, next),
          )
      }
    },
  })
}

function createPathNode(source: SQLJSONValue, path: string): unknown {
  // The path is bound as one text parameter. Every literal in it was encoded
  // with JSON.stringify, which jsonpath parses as a JSON string or number.
  const pathParam = () => sql`${path}::text::jsonpath`

  return new Proxy(Object.create(null), {
    get(_, property) {
      if (typeof property === 'symbol') return undefined
      switch (property) {
        case '$exists':
          return sql<boolean>`${jsonSource(source)} @? ${pathParam()}`
        case '$query':
          return sql`jsonb_path_query_array(${jsonSource(source)}, ${pathParam()})`
        case '$first':
          return sql`jsonb_path_query_first(${jsonSource(source)}, ${pathParam()})`
        default:
          return navigate(path, property, (next) =>
            createPathNode(source, next),
          )
      }
    },
  })
}

/**
 * Builds a typed SQL/JSON path over a JSONB source. Navigate with property
 * access, `$each` (`[*]`), `$values` (`.*`), and `$entries` (`.keyvalue()`),
 * narrow with `$filter(...)` and `$match(...)`, then finish with `$exists`,
 * `$query`, or `$first`.
 */
export function jsonPath<Source extends SQLJSONValue>(
  source: Source,
): SQLJSONPathOf<Source> {
  return createPathNode(source, '$') as SQLJSONPathOf<Source>
}
