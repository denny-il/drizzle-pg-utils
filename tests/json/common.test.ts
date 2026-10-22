import { type SQL, sql } from 'drizzle-orm'
import { describe, expect, expectTypeOf, it } from 'vitest'

import type {
  SQLJSONDenullify,
  SQLJSONExtractType,
  SQLJSONIsNullish,
  SQLJSONNullify,
} from '../../src/json/types.ts'
import { normalizeNullish } from '../../src/json/utils.ts'
import { dialect } from '../utils.ts'

describe('JSON Common Types and Utilities', () => {
  describe('Type Utilities', () => {
    it('SQLJSONExtractType extracts correct types', () => {
      const _sqlExpr = sql<{
        test: string
        num: number
      }>`'{"test": "value", "num": 42}'::jsonb`
      type ExtractedType = SQLJSONExtractType<typeof _sqlExpr>
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
    it('coalesces SQL NULL to JSON null', () => {
      const jsonValue = sql<{ test: string } | null>`'{"test": "value"}'::jsonb`
      const result = normalizeNullish(jsonValue)

      expect(dialect.sqlToQuery(result).sql).toBe(
        `coalesce('{"test": "value"}'::jsonb, 'null'::jsonb)`,
      )
      expectTypeOf(result).toEqualTypeOf<
        SQL<{
          test: string
        } | null>
      >()
    })

    it('keeps the type of non-nullable values', () => {
      const jsonValue = sql<{ test: string }>`'{"test": "value"}'::jsonb`
      const result = normalizeNullish(jsonValue)

      expectTypeOf(result).toEqualTypeOf<SQL<{ test: string }>>()
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
})
