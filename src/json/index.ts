import { jsonAccess } from './operations/access.ts'
import {
  jsonArrayDelete,
  jsonArrayPush,
  jsonArraySet,
} from './operations/array.ts'
import { jsonBuild } from './operations/build.ts'
import { jsonCoalesce } from './operations/coalesce.ts'
import { jsonContains } from './operations/contains.ts'
import { jsonMerge } from './operations/merge.ts'
import { jsonPath } from './operations/path.ts'
import { jsonRef, jsonRefPipe } from './operations/ref.ts'
import { jsonSet, jsonSetPipe } from './operations/set.ts'
import type { SQLJSONRefAPI } from './types.ts'

/**
 * @deprecated Use `json(source).path.$value` / `.$text` instead.
 */
export { jsonAccess as access } from './operations/access.ts'
export {
  jsonArrayDelete as arrayDelete,
  jsonArrayPush as arrayPush,
  jsonArraySet as arraySet,
} from './operations/array.ts'
export { jsonBuild as build } from './operations/build.ts'
export { jsonCoalesce as coalesce } from './operations/coalesce.ts'
/**
 * @deprecated Use `json(source).path.$contains(...)` / `json(source).$contains(...)` instead.
 */
export { jsonContains as contains } from './operations/contains.ts'
export { jsonMerge as merge } from './operations/merge.ts'
export { jsonPath as path } from './operations/path.ts'
export { jsonRefPipe as pipe } from './operations/ref.ts'
/**
 * @deprecated Use `json(source).path.$set(...)` / `.$default(...)` instead.
 */
export { jsonSet as set } from './operations/set.ts'
/**
 * @deprecated Use `json(source).$pipe(...)` instead.
 */
export { jsonSetPipe as setPipe } from './operations/set.ts'

const jsonRoot: typeof jsonRef = (source) => jsonRef(source)

export const json: SQLJSONRefAPI = Object.assign(jsonRoot, {
  access: jsonAccess,
  arrayDelete: jsonArrayDelete,
  arrayPush: jsonArrayPush,
  arraySet: jsonArraySet,
  build: jsonBuild,
  coalesce: jsonCoalesce,
  contains: jsonContains,
  merge: jsonMerge,
  path: jsonPath,
  pipe: jsonRefPipe,
  set: jsonSet,
  setPipe: jsonSetPipe,
})

export type {
  SQLJSONPath,
  SQLJSONPathEntry,
  SQLJSONPathFilter,
  SQLJSONPathOf,
  SQLJSONPathPredicate,
  SQLJSONPathPredicates,
} from './operations/path.ts'
export type { SQLJSONRef, SQLJSONRefPipeFn } from './operations/ref.ts'
export type { SQLJSONRefAPI } from './types.ts'
