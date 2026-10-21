import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm/sql'

import type {
  SQLJSONDenullify,
  SQLJSONExtractType,
  SQLJSONIsNullish,
  SQLJSONNullify,
  SQLJSONValue,
} from '../types.ts'
import { jsonExtract, jsonExtractText } from '../utils.ts'

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
  IsObject extends (ObjectType extends object ? true : false) =
    ObjectType extends object ? true : false,
> = (ObjectType extends readonly (infer Element)[]
  ? // Index access only; a mapped type would also expose array members such
    // as `length` and `map` as JSON paths.
    { [index: number]: SQLJSONAccess<SQL<Element | null>> }
  : IsObject extends false
    ? {}
    : {
        [K in keyof ObjectType]-?: SQLJSONAccess<
          SQL<ObjectType[K] | (IsNullish extends true ? null : never)>
        >
      }) & {
  $value: SQL<SQLJSONNullify<IsNullish, Type>>
  $text: SQL<SQLJSONNullify<IsNullish, string>>
}

export function jsonAccess<Source extends SQLJSONValue>(
  source: Source,
): SQLJSONAccess<Source> {
  function buildPath(path: string[]) {
    return jsonExtract(source, path)
  }

  function buildValue(path: string[]) {
    return jsonExtractText(source, path)
  }

  function createProxy(path: string[] = []) {
    return new Proxy(Object.create(null), {
      get(_, property) {
        if (typeof property === 'symbol')
          throw new TypeError('Symbols are not supported in JSON paths')
        if (property === '$value') {
          return buildPath(path)
        }
        if (property === '$text') {
          return buildValue(path)
        }
        return createProxy([...path, property])
      },
    })
  }

  return createProxy() as any
}
