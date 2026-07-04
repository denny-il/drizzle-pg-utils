import { isSQLWrapper, type SQL } from 'drizzle-orm'
import type {
  SQLJSONDenullify,
  SQLJSONExtractType,
  SQLJSONValue,
} from '../types.ts'
import { jsonContainsPath, jsonWrapPath } from '../utils.ts'

export type SQLJSONContainmentValue<Type> =
  Type extends readonly (infer Element)[]
    ? Array<SQLJSONContainmentValue<Element>>
    : Type extends object
      ? { [K in keyof Type]?: SQLJSONContainmentValue<Type[K]> }
      : Type

export type SQLJSONContains<
  Source extends SQLJSONValue,
  Type = SQLJSONExtractType<Source>,
  ObjectType extends SQLJSONDenullify<Type> = SQLJSONDenullify<Type>,
> = {
  $contains(
    value:
      | SQLJSONContainmentValue<ObjectType>
      | SQLJSONValue<SQLJSONContainmentValue<ObjectType>>,
  ): SQL<boolean>
} & (ObjectType extends readonly (infer Element)[]
  ? {
      [index: number]: SQLJSONContains<Source, Element>
    }
  : ObjectType extends object
    ? {
        [K in keyof ObjectType]-?: SQLJSONContains<Source, ObjectType[K]>
      }
    : {})

export function jsonContains<Source extends SQLJSONValue>(
  source: Source,
): SQLJSONContains<Source>

export function jsonContains<
  Source extends SQLJSONValue,
  SourceType extends SQLJSONExtractType<Source> = SQLJSONExtractType<Source>,
>(
  source: Source,
  value:
    | SQLJSONContainmentValue<SQLJSONDenullify<SourceType>>
    | SQLJSONValue<SQLJSONContainmentValue<SQLJSONDenullify<SourceType>>>,
): SQL<boolean>

export function jsonContains<Source extends SQLJSONValue>(
  source: Source,
  ...args: [
    value?: SQLJSONContainmentValue<SQLJSONExtractType<Source>> | SQLJSONValue,
  ]
): SQL<boolean> | SQLJSONContains<Source> {
  function buildContains(value: SQLJSONContainmentValue<any> | SQLJSONValue) {
    return jsonContainsPath(source, [], value)
  }

  function createProxy(path: string[] = []): SQLJSONContains<Source> {
    return new Proxy(Object.create(null), {
      get(_, property) {
        if (typeof property === 'symbol')
          throw new TypeError('Symbols are not supported in JSON paths')
        if (property === '$contains') {
          return (value: SQLJSONContainmentValue<any> | SQLJSONValue) => {
            if (isSQLWrapper(value)) {
              if (path.length > 0)
                throw new Error(
                  'SQL containment values are only supported at the root path',
                )
              return buildContains(value)
            }
            return buildContains(jsonWrapPath(path, value))
          }
        }
        return createProxy([...path, property])
      },
    }) as SQLJSONContains<Source>
  }

  if (args.length === 0) return createProxy()

  return buildContains(args[0])
}
