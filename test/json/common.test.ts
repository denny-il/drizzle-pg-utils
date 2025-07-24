import { type SQL, sql } from 'drizzle-orm'
import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  normalizeNullish,
  normalizeNullishArray,
  type SQLJSONDenullify,
  type SQLJSONExtractType,
  type SQLJSONIsNullish,
  type SQLJSONNullify,
} from '../../src/json/common.ts'

describe('JSON Common Types and Utilities', () => {
  describe('Type Utilities', () => {
    it('SQLJSONValue accepts SQL expressions', () => {
      const sqlExpr = sql<{ test: string }>`'{"test": "value"}'::jsonb`
      expectTypeOf(sqlExpr).toEqualTypeOf<
        SQL<{
          test: string
        }>
      >()
    })

    it('SQLJSONExtractType extracts correct types', () => {
      const sqlExpr = sql<{
        test: string
        num: number
      }>`'{"test": "value", "num": 42}'::jsonb`
      type ExtractedType = SQLJSONExtractType<typeof sqlExpr>
      expectTypeOf<ExtractedType>().toEqualTypeOf<{
        test: string
        num: number
      }>()
    })

    it('SQLJSONIsNullish detects nullable types', () => {
      type NullableType = string | null
      type NonNullableType = string

      expectTypeOf<SQLJSONIsNullish<NullableType>>().toEqualTypeOf<true>()
      expectTypeOf<SQLJSONIsNullish<NonNullableType>>().toEqualTypeOf<false>()
    })

    it('SQLJSONNullify handles nullability correctly', () => {
      type TestType = string
      type NullifiedTrue = SQLJSONNullify<true, TestType>
      type NullifiedFalse = SQLJSONNullify<false, TestType>

      expectTypeOf<NullifiedTrue>().toEqualTypeOf<string | null>()
      expectTypeOf<NullifiedFalse>().toEqualTypeOf<string>()
    })

    it('SQLJSONDenullify removes null and undefined', () => {
      type NullableType = string | null | undefined
      type DenullifiedType = SQLJSONDenullify<NullableType>

      expectTypeOf<DenullifiedType>().toEqualTypeOf<string>()
    })
  })

  describe('normalizeNullish', () => {
    it('generates SQL for null normalization', () => {
      const jsonValue = sql<{ test: string } | null>`'{"test": "value"}'::jsonb`
      const result = normalizeNullish(jsonValue)

      expect(result).toBeDefined()
      expectTypeOf(result).toEqualTypeOf<
        SQL<{
          test: string
        } | null>
      >()
    })

    it('handles non-nullable values', () => {
      const jsonValue = sql<{ test: string }>`'{"test": "value"}'::jsonb`
      // This should still work even for non-nullable types
      const result = normalizeNullish(jsonValue)

      expect(result).toBeDefined()
    })

    it('works with different JSON types', () => {
      const stringValue = sql<string | null>`'"test"'::jsonb`
      const numberValue = sql<number | null>`'42'::jsonb`
      const arrayValue = sql<string[] | null>`'["a", "b"]'::jsonb`

      const stringResult = normalizeNullish(stringValue)
      const numberResult = normalizeNullish(numberValue)
      const arrayResult = normalizeNullish(arrayValue)

      expect(stringResult).toBeDefined()
      expect(numberResult).toBeDefined()
      expect(arrayResult).toBeDefined()
    })
  })

  describe('normalizeNullishArray', () => {
    it('generates SQL for array normalization', () => {
      const arrayValue = sql<number[] | null>`'[1, 2, 3]'::jsonb`
      const result = normalizeNullishArray(arrayValue)

      expect(result).toBeDefined()
      expectTypeOf(result).toEqualTypeOf<SQL<number[]>>()
    })

    it('handles null array values', () => {
      const nullArray = sql<string[] | null>`NULL::jsonb`
      const result = normalizeNullishArray(nullArray)

      expect(result).toBeDefined()
    })

    it('handles empty arrays', () => {
      const emptyArray = sql<any[]>`'[]'::jsonb`
      const result = normalizeNullishArray(emptyArray)

      expect(result).toBeDefined()
    })

    it('handles different array types', () => {
      const stringArray = sql<string[] | null>`'["a", "b"]'::jsonb`
      const numberArray = sql<number[] | null>`'[1, 2]'::jsonb`
      const objectArray = sql<Array<{
        id: number
      }> | null>`'[{"id": 1}]'::jsonb`

      const stringResult = normalizeNullishArray(stringArray)
      const numberResult = normalizeNullishArray(numberArray)
      const objectResult = normalizeNullishArray(objectArray)

      expect(stringResult).toBeDefined()
      expect(numberResult).toBeDefined()
      expect(objectResult).toBeDefined()
    })
  })

  describe('Type Inference Edge Cases', () => {
    it('handles union types correctly', () => {
      type UnionType = string | number | boolean
      type Denullified = SQLJSONDenullify<UnionType | null>

      expectTypeOf<Denullified>().toEqualTypeOf<string | number | boolean>()
    })

    it('handles complex nested types', () => {
      type ComplexType = {
        user: {
          id: number
          profile: {
            settings: Record<string, any>
          } | null
        }
        tags: string[]
      } | null

      type Denullified = SQLJSONDenullify<ComplexType>
      expectTypeOf<Denullified>().toEqualTypeOf<{
        user: {
          id: number
          profile: {
            settings: Record<string, any>
          } | null
        }
        tags: string[]
      }>()
    })

    it('preserves array element types', () => {
      type ArrayType = Array<{ id: number; name: string }> | null
      type Denullified = SQLJSONDenullify<ArrayType>

      expectTypeOf<Denullified>().toEqualTypeOf<
        Array<{ id: number; name: string }>
      >()
    })
  })

  describe('Runtime Behavior', () => {
    it('normalizeNullish creates proper SQL structure', () => {
      const testValue = sql<string | null>`'test'::jsonb`
      const result = normalizeNullish(testValue)

      // Check that it's a SQL object with the expected structure
      expect(result).toBeDefined()
      expect(typeof result).toBe('object')
    })

    it('normalizeNullishArray creates proper SQL structure', () => {
      const testArray = sql<string[] | null>`'["test"]'::jsonb`
      const result = normalizeNullishArray(testArray)

      // Check that it's a SQL object with the expected structure
      expect(result).toBeDefined()
      expect(typeof result).toBe('object')
    })
  })

  describe('Type Compatibility', () => {
    it('works with SQL expressions', () => {
      const sqlValue = sql<{ test: string }>`'{"test": "value"}'::jsonb`
      expectTypeOf(sqlValue).toEqualTypeOf<
        SQL<{
          test: string
        }>
      >()
    })

    it('preserves SQL wrapper types', () => {
      const sqlValue = sql<{ test: string }>`'{"test": "value"}'::jsonb`
      const aliased = sqlValue.as('test_alias')

      expectTypeOf(aliased).toEqualTypeOf<
        SQL.Aliased<{
          test: string
        }>
      >()
    })
  })
})
