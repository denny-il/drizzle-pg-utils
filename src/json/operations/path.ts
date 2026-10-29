import { is, isSQLWrapper, SQL, sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  QueryBuilder,
  type SubqueryWithSelection,
} from 'drizzle-orm/pg-core'

import { jsonSource } from '../source.ts'
import type {
  SQLJSONExtractType,
  SQLJSONIsNullish,
  SQLJSONValue,
} from '../types.ts'
import { jsonRef, type SQLJSONRef } from './ref.ts'

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
declare const variableType: unique symbol

/**
 * A condition built inside a `$filter(...)` callback. It is only valid in the
 * callback that created it, because `@` names a different item in each one.
 */
export interface SQLJSONPathPredicate {
  readonly [predicateBrand]: true
}

/**
 * A SQL value passed into the path as a jsonpath variable (`$v1`), created
 * with `p.sql(...)`. `V` is its SQL type, which comparisons check.
 */
export interface SQLJSONPathVariable<V> {
  readonly [variableType]: V
}

type SQLScalarSource =
  | SQL<Scalar>
  | SQL.Aliased<Scalar>
  | AnyPgColumn<{ data: string | number | boolean }>
type SQLScalarType<S> = S extends AnyPgColumn
  ? S['_']['notNull'] extends true
    ? S['_']['data']
    : S['_']['data'] | null
  : S extends SQL<infer V> | SQL.Aliased<infer V>
    ? V
    : never

/**
 * Combinators passed to `$filter(...)` callbacks. `undefined` operands are
 * skipped, so optional conditions can be written inline; when nothing is
 * left, the result is `undefined` and the filter is omitted.
 */
export type SQLJSONPathPredicates = {
  /**
   * Compares against a SQL value (a column or typed `sql<T>`) through a
   * jsonpath variable. Untyped parameters need a cast, e.g. `sql<number>\`${n}::float8\``.
   * Paths with variables can't use the `@?`/`@@` operators, so they lose GIN
   * index support; SQL `NULL` becomes JSON `null`.
   */
  sql<S extends SQLScalarSource>(
    value: S,
  ): SQLJSONPathVariable<SQLScalarType<S>>
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

// Variables are widened to their base type, so a text column can be compared
// with a literal-union field; they may be SQL NULL, which jsonpath compares as
// JSON null.
type Widen<V> = V extends string
  ? string
  : V extends number
    ? number
    : V extends boolean
      ? boolean
      : V
type Operand<V> = V | SQLJSONPathVariable<Widen<V> | null>

type FilterPredicates<T> = {
  /** `exists(@...)`: the path yields at least one item, JSON `null` included. */
  readonly $exists: SQLJSONPathPredicate
  /** `@... == null`: the value is present and JSON `null`. */
  readonly $isNull: SQLJSONPathPredicate
} & ([EqValue<T>] extends [never]
  ? {}
  : {
      $eq(value: Operand<EqValue<T>>): SQLJSONPathPredicate
      $ne(value: Operand<EqValue<T>>): SQLJSONPathPredicate
      $in(values: readonly Operand<EqValue<T>>[]): SQLJSONPathPredicate
    }) &
  ([OrderValue<T>] extends [never]
    ? {}
    : {
        $lt(value: Operand<OrderValue<T>>): SQLJSONPathPredicate
        $lte(value: Operand<OrderValue<T>>): SQLJSONPathPredicate
        $gt(value: Operand<OrderValue<T>>): SQLJSONPathPredicate
        $gte(value: Operand<OrderValue<T>>): SQLJSONPathPredicate
      }) &
  ([StringValue<T>] extends [never]
    ? {}
    : {
        $startsWith(prefix: string): SQLJSONPathPredicate
        /** POSIX regex via `like_regex`; `flags` combines `i`, `m`, `s`, `q`. */
        $regex(pattern: string, flags?: string): SQLJSONPathPredicate
      })

type FilterNavigation<T> = {
  /** `.**`: the item and every value nested in it, at any depth. */
  readonly $deep: SQLJSONPathFilter<unknown>
} & (IsUnknown<T> extends true
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
      : {})

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

type PathNavigation<T, Nullable extends boolean, Strict extends boolean> = {
  /**
   * `.**`: the item and every value nested in it, at any depth. Lax mode can
   * yield an item twice when the descent passes through arrays; strict mode
   * does not.
   */
  readonly $deep: SQLJSONPath<unknown, Nullable, Strict>
} & (IsUnknown<T> extends true
  ? {
      readonly $each: SQLJSONPath<unknown, Nullable, Strict>
      readonly $values: SQLJSONPath<unknown, Nullable, Strict>
      readonly $entries: SQLJSONPath<
        SQLJSONPathEntry<unknown>,
        Nullable,
        Strict
      >
      $key(key: string): SQLJSONPath<unknown, Nullable, Strict>
    }
  : IsArray<T> extends true
    ? {
        readonly $each: SQLJSONPath<ArrayItem<T>, Nullable, Strict>
        readonly [index: number]: SQLJSONPath<ArrayItem<T>, Nullable, Strict>
      }
    : IsObject<T> extends true
      ? {
          readonly $values: SQLJSONPath<
            ObjectValues<Defined<T>>,
            Nullable,
            Strict
          >
          readonly $entries: SQLJSONPath<
            SQLJSONPathEntry<Defined<T>>,
            Nullable,
            Strict
          >
          $key<K extends string>(
            key: K,
          ): SQLJSONPath<ObjectMember<Defined<T>, K>, Nullable, Strict>
        } & {
          readonly [K in ObjectKeys<Defined<T>>]: SQLJSONPath<
            Present<Defined<T>[K]>,
            Nullable,
            Strict
          >
        }
      : {})

/** Target types for `$valueAs(...)`, limited to ones every driver decodes alike. */
export type SQLJSONPathValueTypes = {
  text: string
  integer: number
  'double precision': number
  boolean: boolean
}

/** `null` (the default) returns SQL `NULL`; `error` raises. */
export type SQLJSONPathValueOptions = {
  onEmpty?: 'null' | 'error'
  onError?: 'null' | 'error'
}

export type SQLJSONPathOptions = {
  /**
   * `lax` (default) skips missing keys and unwraps arrays. `strict` raises on
   * them in `$query`, `$first`, `$rows`, and aggregates, makes `$exists` SQL
   * `NULL`, and makes `$valueAs` `NULL` unless `onError: 'error'`.
   */
  mode?: 'lax' | 'strict'
}

type RowColumns = Record<string, SQL<unknown>>
type RowSelection<C extends RowColumns> = {
  [K in keyof C]: SQL.Aliased<C[K]['_']['type']>
}

type NumberAggregates<T> =
  IsUnknown<T> extends true
    ? {}
    : [Defined<T>] extends [never]
      ? {}
      : [Defined<T>] extends [number]
        ? {
            /** Sum of the numbers, ignoring JSON `null`; SQL `NULL` when none. */
            readonly $sum: SQL<number | null>
            readonly $avg: SQL<number | null>
            readonly $min: SQL<number | null>
            readonly $max: SQL<number | null>
          }
        : {}

/**
 * A typed, read-only SQL/JSON path over a JSONB source. `T` is the type of
 * one item the path yields; `Nullable` tracks whether the source itself can be
 * SQL `NULL`; `Strict` is the path mode.
 */
export type SQLJSONPath<
  T,
  Nullable extends boolean = true,
  Strict extends boolean = false,
> = {
  /**
   * `source @? path`: whether the path yields any item. GIN-indexable unless
   * the path uses `p.sql(...)` variables.
   */
  readonly $exists: SQL<
    | boolean
    | (Nullable extends true ? null : Strict extends true ? null : never)
  >
  /** `jsonb_path_query_array(...)`: every yielded item, `[]` when none. */
  readonly $query: SQL<Present<T>[] | (Nullable extends true ? null : never)>
  /** `jsonb_path_query_first(...)`: the first yielded item, or SQL `NULL`. */
  readonly $first: SQL<Present<T> | null>
  /** How many items the path yields, JSON `null` included; 0 for SQL `NULL`. */
  readonly $count: SQL<number>
  /**
   * `source @@ predicate`: the predicate's three-valued result. The callback
   * node stands for this path; SQL `NULL` when the result is unknown, e.g. a
   * comparison across JSON types.
   */
  $test(fn: SQLJSONPathFilterFn<T>): SQL<boolean | null>
  /**
   * `JSON_VALUE(... RETURNING type)`, PostgreSQL 17+: the single scalar the
   * path yields, converted to `type` (numeric strings included). SQL `NULL`
   * when there is none, more than one, or it does not convert.
   */
  $valueAs<K extends keyof SQLJSONPathValueTypes>(
    type: K,
    options?: SQLJSONPathValueOptions,
  ): SQL<SQLJSONPathValueTypes[K] | null>
  /**
   * One row per yielded item, as a subquery for `crossJoinLateral(...)` or
   * `leftJoinLateral(..., sql\`true\`)`. Columns are built from a typed ref
   * to the item and its 1-based position.
   */
  $rows<A extends string, C extends RowColumns>(
    alias: A,
    columns: (item: SQLJSONRef<SQL<Present<T>>>, ordinality: SQL<number>) => C,
  ): SubqueryWithSelection<RowSelection<C>, A>
} & NumberAggregates<T> &
  PathNavigation<T, Nullable, Strict> &
  (CanFilter<T> extends true
    ? {
        $filter(fn: SQLJSONPathFilterFn<T>): SQLJSONPath<T, Nullable, Strict>
      }
    : {}) &
  (IsObject<T> extends true
    ? {
        $match<const M extends MatchShape<Defined<T>>>(
          shape: MatchArgument<Defined<T>, M>,
        ): SQLJSONPath<MatchNarrow<T, M>, Nullable, Strict>
      }
    : {})

export type SQLJSONPathOf<
  Source extends SQLJSONValue,
  Strict extends boolean = false,
> = SQLJSONPath<
  SQLJSONExtractType<Source>,
  SQLJSONIsNullish<SQLJSONExtractType<Source>> extends true
    ? true
    : Source extends AnyPgColumn
      ? Source['_']['notNull'] extends true
        ? false
        : true
      : false,
  Strict
>

/** One `$filter(...)` callback; `@` means a different item in each. */
class PathScope {}

// SQL values referenced by id from path text. The text holds a token per
// variable, `\u0001<id>\u0001`, which terminals rename to `$v1`, `$v2`, ...
// Raw control characters never appear otherwise: keys and string literals go
// through JSON.stringify, which escapes them.
type Variables = ReadonlyMap<number, SQL>
const noVariables: Variables = new Map()
// oxlint-disable-next-line no-control-regex -- the token delimiter
const variableToken = /\u0001(\d+)\u0001/g
let lastVariableId = 0

class PathVariable {
  readonly id = ++lastVariableId
  constructor(readonly value: SQL) {}
}

function mergeVariables(...sets: Variables[]): Variables {
  const present = sets.filter((set) => set.size > 0)
  if (present.length <= 1) return present[0] ?? noVariables
  return new Map(present.flatMap((set) => [...set]))
}

class PathPredicate {
  constructor(
    readonly text: string,
    readonly scope: PathScope,
    readonly variables: Variables = noVariables,
  ) {}
}

/** Path text plus the SQL values its variable tokens refer to. */
type PathState = { readonly text: string; readonly variables: Variables }

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
    'JSON path values must be strings, finite numbers, booleans, null, or p.sql(...) variables',
  )
}

function pathOrderLiteral(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number')
    throw new TypeError(
      'JSON path comparisons take a string, a number, or a p.sql(...) variable',
    )
  return pathLiteral(value)
}

/** A literal, or the token for a `p.sql(...)` variable. */
function pathOperand(
  value: unknown,
  literal: (value: unknown) => string,
): PathState {
  if (value instanceof PathVariable)
    return {
      text: `\u0001${value.id}\u0001`,
      variables: new Map([[value.id, value.value]]),
    }
  return { text: literal(value), variables: noVariables }
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
      mergeVariables(...predicates.map((predicate) => predicate.variables)),
    )
  }

  return {
    and: (...values: unknown[]) => combine('&&', values),
    or: (...values: unknown[]) => combine('||', values),
    not: (value: unknown) => {
      if (value === undefined) return undefined
      assertPredicate(value, scope)
      return new PathPredicate(`!(${value.text})`, scope, value.variables)
    },
    sql: (value: unknown) => {
      if (!isSQLWrapper(value))
        throw new TypeError(
          'p.sql(...) takes a column or a SQL expression, e.g. sql<number>`...`',
        )
      return new PathVariable(sql`${jsonSource(value)}`)
    },
  } as unknown as SQLJSONPathPredicates
}

/** Runs a predicate callback; `undefined` when it returns no condition. */
function runPredicate(
  fn: unknown,
  name: string,
  path: PathState,
): PathPredicate | undefined {
  if (typeof fn !== 'function') throw new TypeError(`${name} takes a callback`)
  const scope = new PathScope()
  const predicate = fn(createFilterNode(scope, path), createPredicates(scope))
  if (predicate === undefined) return undefined
  assertPredicate(predicate, scope)
  return predicate
}

function buildFilter(path: PathState, fn: unknown): PathState {
  const predicate = runPredicate(fn, '$filter(...)', {
    text: '@',
    variables: noVariables,
  })
  if (predicate === undefined) return path
  return {
    text: `${path.text} ? (${predicate.text})`,
    variables: mergeVariables(path.variables, predicate.variables),
  }
}

function buildMatch(path: PathState, shape: unknown): PathState {
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
  return { ...path, text: `${path.text} ? (${condition})` }
}

// Properties shared by path and filter nodes: navigation and filtering.
// Returns `undefined` for properties the caller should handle itself.
function navigate(
  path: PathState,
  property: string,
  next: (path: PathState) => unknown,
): unknown {
  const step = (text: string) => next({ ...path, text: `${path.text}${text}` })
  switch (property) {
    case '$each':
      return step('[*]')
    case '$values':
      return step('.*')
    case '$deep':
      return step('.**')
    case '$entries':
      // `.keyvalue()` errors on non-objects even in lax mode (e.g. a JSON
      // null map), so skip them like the lax accessors do.
      return step(' ? (@.type() == "object").keyvalue()')
    case '$key':
      return (key: unknown) => step(pathKey(key))
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
      return step(pathSegment(property))
  }
}

// Filter nodes build predicate text. Variables of nested filters in the
// node's own path travel on into every predicate built from it.
function createFilterNode(scope: PathScope, node: PathState): unknown {
  const path = node.text
  const predicate = (state: PathState) =>
    new PathPredicate(
      state.text,
      scope,
      mergeVariables(node.variables, state.variables),
    )
  const comparison = (
    operator: string,
    value: unknown,
    literal: (value: unknown) => string,
  ) => {
    const operand = pathOperand(value, literal)
    return { ...operand, text: `${path} ${operator} ${operand.text}` }
  }
  const compare = (operator: string) => (value: unknown) =>
    predicate(comparison(operator, value, pathLiteral))
  const order = (operator: string) => (value: unknown) =>
    predicate(comparison(operator, value, pathOrderLiteral))
  const text = (text: string) => predicate({ text, variables: noVariables })

  return new Proxy(Object.create(null), {
    get(_, property) {
      if (typeof property === 'symbol') return undefined
      switch (property) {
        case '$exists':
          return text(`exists(${path})`)
        case '$isNull':
          return text(`${path} == null`)
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
            if (values.length === 0) return text('1 == 0')
            const options = values.map((value) =>
              comparison('==', value, pathLiteral),
            )
            if (options.length === 1) return predicate(options[0]!)
            return predicate({
              text: options.map((option) => `(${option.text})`).join(' || '),
              variables: mergeVariables(
                ...options.map((option) => option.variables),
              ),
            })
          }
        case '$startsWith':
          return (prefix: unknown) =>
            text(`${path} starts with ${pathString(prefix, 'prefixes')}`)
        case '$regex':
          return (pattern: unknown, flags?: unknown) => {
            const regex = `${path} like_regex ${pathString(pattern, 'patterns')}`
            if (flags === undefined || flags === '') return text(regex)
            // PostgreSQL rejects `x` as not implemented.
            if (typeof flags !== 'string' || !/^[imsq]+$/.test(flags))
              throw new TypeError(
                'JSON path regex flags must be made of i, m, s, and q',
              )
            return text(`${regex} flag ${JSON.stringify(flags)}`)
          }
        default:
          return navigate(node, property, (next) =>
            createFilterNode(scope, next),
          )
      }
    },
  })
}

const valueTypes: ReadonlySet<string> = new Set<keyof SQLJSONPathValueTypes>([
  'text',
  'integer',
  'double precision',
  'boolean',
])
const aggregates: Readonly<Record<string, string>> = {
  $sum: 'sum',
  $avg: 'avg',
  $min: 'min',
  $max: 'max',
}
// Fixed aliases for the item set inside generated subqueries. They are only
// referenced inside the subquery, which is its own scope.
const itemsAlias = sql.identifier('jsonb_path_items')

function valueBehavior(value: unknown, on: string): SQL | undefined {
  if (value === undefined) return undefined
  if (value !== 'null' && value !== 'error')
    throw new TypeError(`$valueAs(...) ${on} must be 'null' or 'error'`)
  return sql.raw(` ${value} on ${on.slice(2).toLowerCase()}`)
}

function createPathNode(
  source: SQLJSONValue,
  path: PathState,
  strict: boolean,
): unknown {
  const target = () => jsonSource(source)
  // The path is bound as one text parameter. Every literal in it was encoded
  // with JSON.stringify, which jsonpath parses as a JSON string or number.
  const render = (state: PathState) => {
    const names = new Map<number, string>()
    const text = state.text.replace(variableToken, (_, id: string) => {
      const key = Number(id)
      let name = names.get(key)
      if (name === undefined) names.set(key, (name = `v${names.size + 1}`))
      return `$${name}`
    })
    const path = sql`${strict ? `strict ${text}` : text}::text::jsonpath`
    const variables = [...names].map(
      ([id, name]) => [name, state.variables.get(id)!] as const,
    )
    // Generated names are `v<n>`, safe to embed as SQL literals.
    const object =
      variables.length === 0
        ? undefined
        : sql`jsonb_build_object(${sql.join(
            variables.map(
              ([name, value]) => sql`${sql.raw(`'${name}'`)}, ${value}`,
            ),
            sql`, `,
          )})`
    return { path, variables, object }
  }
  // `fn(source, path[, vars, silent])`, the form every function takes.
  const call = (name: string, state: PathState, silent = false) => {
    const { path, object } = render(state)
    const variables =
      object === undefined
        ? sql``
        : silent
          ? sql`, ${object}, true`
          : sql`, ${object}`
    return sql`${sql.raw(name)}(${target()}, ${path}${variables})`
  }
  const items = (select: SQL) =>
    sql`(select ${select} from ${call('jsonb_path_query', path)} as ${itemsAlias}(item))`

  return new Proxy(Object.create(null), {
    get(_, property) {
      if (typeof property === 'symbol') return undefined
      switch (property) {
        case '$exists': {
          // The operators take no variables; `silent` keeps their error
          // suppression in the function form. Decide on the rendered path:
          // `$in([])` can drop a subpath along with its variables.
          const { path: param, object } = render(path)
          return object === undefined
            ? sql<boolean>`${target()} @? ${param}`
            : call('jsonb_path_exists', path, true)
        }
        case '$query':
          return call('jsonb_path_query_array', path)
        case '$first':
          return call('jsonb_path_query_first', path)
        case '$count':
          // count(*) is bigint, which some drivers decode as a string.
          return items(sql`count(*)::int`)
        case '$sum':
        case '$avg':
        case '$min':
        case '$max':
          return items(
            sql`${sql.raw(aggregates[property]!)}(nullif(${itemsAlias}.item, 'null'::jsonb)::float8)`,
          )
        case '$test':
          return (fn: unknown) => {
            const predicate = runPredicate(fn, '$test(...)', path)
            // `@@` takes a bare predicate, where `true` is valid.
            const state: PathState = predicate ?? {
              text: 'true',
              variables: noVariables,
            }
            const { path: param, object } = render(state)
            return object === undefined
              ? sql<boolean | null>`${target()} @@ ${param}`
              : call('jsonb_path_match', state, true)
          }
        case '$valueAs':
          return (type: unknown, options: SQLJSONPathValueOptions = {}) => {
            if (typeof type !== 'string' || !valueTypes.has(type))
              throw new TypeError(
                `$valueAs(...) type must be one of ${[...valueTypes].join(', ')}`,
              )
            const { path: param, variables } = render(path)
            const passing =
              variables.length === 0
                ? sql``
                : sql` passing ${sql.join(
                    variables.map(
                      ([name, value]) => sql`${value} as ${sql.raw(name)}`,
                    ),
                    sql`, `,
                  )}`
            return sql`json_value(${target()}, ${param}${passing} returning ${sql.raw(type)}${valueBehavior(options.onEmpty, 'onEmpty')}${valueBehavior(options.onError, 'onError')})`
          }
        case '$rows':
          return (alias: unknown, columns: unknown) => {
            if (typeof alias !== 'string')
              throw new TypeError('$rows(...) alias must be a string')
            if (typeof columns !== 'function')
              throw new TypeError('$rows(...) takes a columns callback')
            const fields = columns(
              jsonRef(sql`${itemsAlias}.item`),
              // ordinality is bigint, which some drivers decode as a string.
              sql<number>`${itemsAlias}.ord::int`,
            )
            if (typeof fields !== 'object' || fields === null)
              throw new TypeError('$rows(...) columns must return an object')
            const selection = Object.fromEntries(
              Object.entries(fields).map(([name, value]) => {
                if (!is(value, SQL))
                  throw new TypeError(
                    `$rows(...) column "${name}" must be a SQL expression, e.g. item.name.$text`,
                  )
                return [name, value.as(name)]
              }),
            )
            return new QueryBuilder()
              .select(selection)
              .from(
                sql`${call('jsonb_path_query', path)} with ordinality as ${itemsAlias}(item, ord)`,
              )
              .as(alias)
          }
        default:
          return navigate(path, property, (next) =>
            createPathNode(source, next, strict),
          )
      }
    },
  })
}

/**
 * Builds a typed SQL/JSON path over a JSONB source. Navigate with property
 * access, `$each` (`[*]`), `$values` (`.*`), `$entries` (`.keyvalue()`), and
 * `$deep` (`.**`), narrow with `$filter(...)` and `$match(...)`, then finish
 * with a terminal such as `$exists`, `$query`, `$first`, or `$rows(...)`.
 */
export function jsonPath<Source extends SQLJSONValue>(
  source: Source,
  options?: { mode?: 'lax' },
): SQLJSONPathOf<Source>
export function jsonPath<Source extends SQLJSONValue>(
  source: Source,
  options: { mode: 'strict' },
): SQLJSONPathOf<Source, true>
// A mode only known at runtime gets strict-mode nullability.
export function jsonPath<Source extends SQLJSONValue>(
  source: Source,
  options?: SQLJSONPathOptions,
): SQLJSONPathOf<Source, boolean>
export function jsonPath(
  source: SQLJSONValue,
  options: SQLJSONPathOptions = {},
): unknown {
  const { mode = 'lax' } = options
  if (mode !== 'lax' && mode !== 'strict')
    throw new TypeError(`JSON path mode must be 'lax' or 'strict'`)
  return createPathNode(
    source,
    { text: '$', variables: noVariables },
    mode === 'strict',
  )
}
