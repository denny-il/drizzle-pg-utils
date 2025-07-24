import { type SQL, sql } from 'drizzle-orm'
import {
  normalizeNullish,
  type SQLJSONDenullify,
  type SQLJSONIsNullish,
  type SQLJSONValue,
} from './common.ts'

/**
 * Type helper to determine the result type of merging two JSON values
 * Following PostgreSQL JSONB || operator behavior:
 *
 * Special NULL handling:
 * - If left is SQL NULL, result is right operand
 * - If right is SQL NULL, result is left operand
 * - If both are SQL NULL, result is SQL NULL
 *
 * For non-NULL values:
 * - Arrays + Arrays = Combined array
 * - Objects + Objects = Merged object (right takes precedence on duplicate keys)
 * - Array + Non-array = Array with non-array appended (including JSON null)
 * - Non-array + Array = Array with non-array prepended (including JSON null)
 * - Non-array + Non-array = Array containing both values (including JSON null)
 *
 * Note: JSON null ('null'::jsonb) is treated as a literal value, not as absence of value
 * Note: SQL NULL is handled specially by || operator (acts like COALESCE)
 */
/**
 * Type helper to determine the result type of merging two JSON values
 * Following PostgreSQL JSONB || operator behavior with SQL NULL normalization:
 *
 * SQL NULL normalization:
 * - SQL NULL values are converted to JSON null ('null'::jsonb) before merging
 * - This ensures consistent behavior regardless of SQL NULL vs JSON null
 *
 * For normalized values:
 * - Arrays + Arrays = Combined array
 * - Objects + Objects = Merged object (right takes precedence on duplicate keys)
 * - Array + Non-array = Array with non-array appended (including JSON null)
 * - Non-array + Array = Array with non-array prepended (including JSON null)
 * - Non-array + Non-array = Array containing both values (including JSON null)
 *
 * Note: All null values are treated as JSON null literals after normalization
 */
type SQLJSONMergeResult<Left, Right> =
  // Since we normalize SQL NULL to JSON null with COALESCE, the result is always a concrete JSON value
  // We work with the actual types, converting any potential SQL NULL to JSON null
  SQLJSONMergeResultInternal<
    SQLJSONIsNullish<Left> extends true ? SQLJSONDenullify<Left> | null : Left,
    SQLJSONIsNullish<Right> extends true
      ? SQLJSONDenullify<Right> | null
      : Right
  >

type SQLJSONMergeResultInternal<Left, Right> =
  // If both are arrays, result is an array containing elements from both
  Left extends readonly any[]
    ? Right extends readonly any[]
      ? [...Left, ...Right]
      : [...Left, Right]
    : // If left is not array but right is, convert left to single-element array and concatenate
      Right extends readonly any[]
      ? [Left, ...Right]
      : // Check for JSON null explicitly first, since null extends Record<string, any> in TS
        Left extends null
        ? Right extends null
          ? [null, null]
          : Right extends Record<string, any>
            ? [null, Right]
            : [Left, Right]
        : Right extends null
          ? Left extends Record<string, any>
            ? [Left, null]
            : [Left, Right]
          : // If both are objects (and neither is JSON null), merge them (right takes precedence)
            Left extends Record<string, any>
            ? Right extends Record<string, any>
              ? Left & Right
              : // Object + Non-object = Array containing both
                [Left, Right]
            : // If left is not object/array, but right is object, create array
              Right extends Record<string, any>
              ? [Left, Right]
              : // Both are primitives, create array
                [Left, Right]

/**
 * Merge two JSONB values using PostgreSQL's || operator with SQL NULL normalization
 * @param left The left operand (SQL NULL values are converted to JSON null)
 * @param right The right operand (SQL NULL values are converted to JSON null)
 * @returns SQL expression representing the merged JSONB values
 *
 * @see https://www.postgresql.org/docs/current/functions-json.html
 *
 * @example
 * // Merge two objects
 * jsonMerge(sql`'{"a": "b"}'::jsonb`, sql`'{"c": "d"}'::jsonb`)
 * // Results in: {"a": "b", "c": "d"}
 *
 * @example
 * // Merge two arrays
 * jsonMerge(sql`'["a", "b"]'::jsonb`, sql`'["c", "d"]'::jsonb`)
 * // Results in: ["a", "b", "c", "d"]
 *
 * @example
 * // Merge array with non-array
 * jsonMerge(sql`'[1, 2]'::jsonb`, sql`'3'::jsonb`)
 * // Results in: [1, 2, 3]
 *
 * @example
 * // Merge null with array (null is treated as a literal value)
 * jsonMerge(sql`'null'::jsonb`, sql`'[[3, 4]]'::jsonb`)
 * // Results in: [null, [3, 4]]
 *
 * @example
 * // Merge object with JSON null (JSON null is not merged as object property)
 * jsonMerge(sql`'{"a": "a"}'::jsonb`, sql`'null'::jsonb`)
 * // Results in: [{"a": "a"}, null]
 *
 * @example
 * // Merge with SQL NULL (converted to JSON null before merging)
 * jsonMerge(sql`NULL::jsonb`, sql`'{"a": "b"}'::jsonb`)
 * // Results in: [null, {"a": "b"}] (SQL NULL converted to JSON null)
 *
 * @example
 * // Merge JSONB with SQL NULL (converted to JSON null before merging)
 * jsonMerge(sql`'{"a": "b"}'::jsonb`, sql`NULL::jsonb`)
 * // Results in: [{"a": "b"}, null] (SQL NULL converted to JSON null)
 */
export function jsonMerge<
  Left extends SQLJSONValue,
  Right extends SQLJSONValue,
  LeftType extends Left['_'] extends { brand: 'Column' }
    ? Left['_']['data']
    : Left['_'] extends { brand: 'SQL' }
      ? Left['_']['type']
      : never = Left['_'] extends { brand: 'Column' }
    ? Left['_']['data']
    : Left['_'] extends { brand: 'SQL' }
      ? Left['_']['type']
      : never,
  RightType extends Right['_'] extends { brand: 'Column' }
    ? Right['_']['data']
    : Right['_'] extends { brand: 'SQL' }
      ? Right['_']['type']
      : never = Right['_'] extends { brand: 'Column' }
    ? Right['_']['data']
    : Right['_'] extends { brand: 'SQL' }
      ? Right['_']['type']
      : never,
  // For merge operations, we work with the full types including null
  // because JSON null is treated as a literal value, not as absence of value
  MergedType extends SQLJSONMergeResult<
    LeftType,
    RightType
  > = SQLJSONMergeResult<LeftType, RightType>,
  // Since we use COALESCE to convert SQL NULL to JSON null, the result is never SQL NULL
  // The result can only be nullish if the operation itself could fail (which it can't for ||)
  FinalType = MergedType,
>(left: Left, right: Right): SQL<FinalType> {
  return sql`${normalizeNullish(left)} || ${normalizeNullish(right)}` as SQL<FinalType>
}
