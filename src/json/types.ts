import type { SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import type { jsonAccess } from './operations/access.ts'
import type {
  jsonArrayDelete,
  jsonArrayPush,
  jsonArraySet,
} from './operations/array.ts'
import type { jsonBuild } from './operations/build.ts'
import type { jsonCoalesce } from './operations/coalesce.ts'
import type { jsonContains } from './operations/contains.ts'
import type { jsonMerge } from './operations/merge.ts'
import type { jsonRef, jsonRefPipe } from './operations/ref.ts'
import type { jsonSet, jsonSetPipe } from './operations/set.ts'

export type SQLJSONValue<T = any> =
  | SQL<T>
  | SQL.Aliased<T>
  | AnyPgColumn<{ dataType: 'object json'; data: T }>
  | AnyPgColumn<{ dataType: 'custom'; data: T }>

export type SQLJSONNullish = null | undefined

export type SQLJSONIsNullish<Type> = null extends Type
  ? true
  : undefined extends Type
    ? true
    : false

export type SQLJSONNullify<
  IsNullish extends boolean,
  Type,
> = IsNullish extends true ? Exclude<Type, SQLJSONNullish> | null : Type

export type SQLJSONDenullify<Type> = Exclude<Type, SQLJSONNullish>

/**
 * Extract the data type from a SQLJSONValue (Column or SQL)
 */
export type SQLJSONExtractType<Source extends SQLJSONValue> =
  Source extends AnyPgColumn<any>
    ? Source['_']['data']
    : Source extends SQL<any> | SQL.Aliased<any>
      ? Source['_']['type']
      : never

export type SQLJSONRefAPI = typeof jsonRef & {
  access: typeof jsonAccess
  arrayDelete: typeof jsonArrayDelete
  arrayPush: typeof jsonArrayPush
  arraySet: typeof jsonArraySet
  build: typeof jsonBuild
  coalesce: typeof jsonCoalesce
  contains: typeof jsonContains
  merge: typeof jsonMerge
  pipe: typeof jsonRefPipe
  set: typeof jsonSet
  /**
   * @deprecated Use `json(source).$pipe(...)` instead.
   */
  setPipe: typeof jsonSetPipe
}
