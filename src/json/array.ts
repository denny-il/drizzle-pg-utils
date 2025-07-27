import { isSQLWrapper, type SQL, sql } from 'drizzle-orm'
import { jsonCoalesce } from './coalesce.ts'
import type {
  SQLJSONDenullify,
  SQLJSONExtractType,
  SQLJSONNullish,
  SQLJSONValue,
} from './common.ts'

type AcceptableValue = any[] | SQLJSONNullish

function valueOrEmptyArray<T extends SQLJSONValue<AcceptableValue>>(
  value: T,
): SQL<SQLJSONDenullify<SQLJSONExtractType<T>>> {
  return jsonCoalesce(
    value,
    sql<SQLJSONDenullify<SQLJSONExtractType<T>>>`'[]'::jsonb`,
  )
}

/**
 * Push a value to the end of a JSONB array.
 * Note, it will create a empty array if the target is null.
 * So it always return a valid array
 *
 * @param target The source JSONB array
 * @param value The value to push
 * @returns SQL expression representing the updated JSONB array
 *
 * @see https://www.postgresql.org/docs/current/functions-json.html#FUNCTIONS-JSON-PROCESSING-TABLE
 *
 * @example
 * // Push to array with SQL expression
 * jsonArrayPush(sql`'[1, 2]'::jsonb`, sql`'3'::jsonb`)
 * // Results in: [1, 2, 3]
 *
 * @example
 * // Push to array with plain JS value
 * jsonArrayPush(sql`'[1, 2]'::jsonb`, 3)
 * // Results in: [1, 2, 3]
 */
export function jsonArrayPush<
  Target extends SQLJSONValue<AcceptableValue>,
  SourceType extends SQLJSONExtractType<Target> = SQLJSONExtractType<Target>,
  ElementType extends
    SQLJSONDenullify<SourceType>[number] = SQLJSONDenullify<SourceType>[number],
>(
  target: Target,
  ...values: Array<ElementType | SQLJSONValue<ElementType>>
): SQL<SQLJSONDenullify<SourceType>> {
  const _values = values.map((value) =>
    isSQLWrapper(value) ? value : sql`${JSON.stringify(value)}::jsonb`,
  )
  const _value = sql`jsonb_build_array(${sql.join(_values, sql`, `)})`
  return sql`${valueOrEmptyArray(target)} || ${_value}`
}

/**
 * Set a value at a specific index in a JSONB array.
 * Note, it will create a empty array if the target is null.
 * So it always return a valid array
 *
 * @param target The source JSONB array
 * @param index The index to set the value at
 * @param value The value to set (can be SQL expression or plain JS value)
 * @returns SQL expression representing the updated JSONB array
 *
 * @see https://www.postgresql.org/docs/current/functions-json.html#FUNCTIONS-JSON-PROCESSING-TABLE
 *
 * @example
 * // Set value at index 1 with SQL expression
 * jsonArraySet(sql`'[1, 2]'::jsonb`, 1, sql`'3'::jsonb`)
 * // Results in: [1, 3]
 *
 * @example
 * // Set value at index 1 with plain JS value
 * jsonArraySet(sql`'[1, 2]'::jsonb`, 1, 3)
 * // Results in: [1, 3]
 */
export function jsonArraySet<
  Target extends SQLJSONValue<AcceptableValue>,
  SourceType extends SQLJSONExtractType<Target> = SQLJSONExtractType<Target>,
  ElementType extends
    SQLJSONDenullify<SourceType>[number] = SQLJSONDenullify<SourceType>[number],
>(
  target: Target,
  index: number,
  value: ElementType | SQLJSONValue<ElementType>,
) {
  const _value = isSQLWrapper(value)
    ? value
    : sql`${JSON.stringify(value)}::jsonb`
  return sql<SourceType>`jsonb_set(${valueOrEmptyArray(target)}, '{${sql`${index}`.inlineParams()}}', ${_value})`
}

/**
 * Delete an element from a JSONB array at a specific index.
 * Note, it will create a empty array if the target is null.
 * So it always return a valid array
 *
 * @param target The source JSONB array
 * @param index The index to delete from the array
 * @returns SQL expression representing the updated JSONB array
 */
export function jsonArrayDelete<
  Target extends SQLJSONValue<AcceptableValue>,
  TargetType extends SQLJSONExtractType<Target> = SQLJSONExtractType<Target>,
>(target: Target, index: number): SQL<SQLJSONDenullify<TargetType>> {
  return sql`${valueOrEmptyArray(target)} - ${sql`${index}`.inlineParams()}`
}
