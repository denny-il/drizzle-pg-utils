import { isSQLWrapper, sql } from 'drizzle-orm'
import {
  normalizeNullishArray,
  type SQLJSONDenullify,
  type SQLJSONExtractType,
  type SQLJSONNullish,
  type SQLJSONValue,
} from './common.ts'

/**
 * Push a value to the end of a JSONB array
 * @param source The source JSONB array
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
  Source extends SQLJSONValue<any[] | SQLJSONNullish>,
  SourceType extends SQLJSONExtractType<Source> = SQLJSONExtractType<Source>,
  ElementType extends
    SQLJSONDenullify<SourceType>[number] = SQLJSONDenullify<SourceType>[number],
>(source: Source, ...values: Array<ElementType | SQLJSONValue<ElementType>>) {
  const _values = values.map((value) =>
    isSQLWrapper(value) ? value : sql`${JSON.stringify(value)}::jsonb`,
  )
  const _value = sql`jsonb_build_array(${sql.join(_values, sql`, `)})`
  return sql<
    SQLJSONDenullify<SourceType>
  >`${normalizeNullishArray(source)} || ${_value}`
}

/**
 * Set a value at a specific index in a JSONB array
 * @param source The source JSONB array
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
  Source extends SQLJSONValue<any[]>,
  SourceType extends SQLJSONExtractType<Source> = SQLJSONExtractType<Source>,
>(
  source: Source,
  index: number,
  value: SourceType[number] | SQLJSONValue<SourceType[number]>,
) {
  const _value = isSQLWrapper(value)
    ? value
    : sql`${JSON.stringify(value)}::jsonb`
  return sql<
    SQLJSONDenullify<SourceType>
  >`jsonb_set(${source}, '{${sql`${index}`.inlineParams()}}', ${_value})`
}

export function jsonArrayDelete<
  Source extends SQLJSONValue<any[]>,
  SourceType extends SQLJSONExtractType<Source> = SQLJSONExtractType<Source>,
>(source: Source, index: number) {
  return sql<SourceType>`${normalizeNullishArray(source)} - ${sql`${index}`.inlineParams()}`
}
