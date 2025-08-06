import { type SQL, sql } from 'drizzle-orm'

import { describe, expect, expectTypeOf, it } from 'vitest'
import { jsonMerge } from '../../src/json/operations/merge.ts'
import { dialect, table } from '../utils.ts'

describe('JSON Merge Operations', () => {
  // Common SQL strings for testing
  const simpleObj1Sql = `'{"a": "hello", "b": 1}'::jsonb`
  const simpleObj2Sql = `'{"b": 2, "c": true}'::jsonb`
  const nestedObj1Sql = `'{"user": {"name": "John"}}'::jsonb`
  const nestedObj2Sql = `'{"user": {"age": 30}}'::jsonb`
  const key1Sql = `'{"key": "value1"}'::jsonb`
  const key2Sql = `'{"key": "value2"}'::jsonb`
  const stringArray1Sql = `'["a", "b"]'::jsonb`
  const stringArray2Sql = `'["c", "d"]'::jsonb`
  const numberArray1Sql = `'[1, 2]'::jsonb`
  const numberArray2Sql = `'["a", "b"]'::jsonb`
  const emptyArraySql = `'[]'::jsonb`
  const arrayItemSql = `'["item"]'::jsonb`
  const numberValueSql = `'3'::jsonb`
  const numberValue1Sql = `'1'::jsonb`
  const arrayValue1Sql = `'[2, 3]'::jsonb`
  const objValueSql = `'{"a": "value"}'::jsonb`
  const array1Sql = `'[1, 2]'::jsonb`
  const stringValueSql = `'"hello"'::jsonb`
  const numberValue42Sql = `'42'::jsonb`
  const objAValueSql = `'{"a": "value"}'::jsonb`
  const nullJsonSql = `'null'::jsonb`
  const deepNestedObj1Sql = `'{"user": {"profile": {"settings": {"theme": "dark"}}}}'::jsonb`
  const deepNestedObj2Sql = `'{"user": {"profile": {"settings": {"language": "en"}}}}'::jsonb`
  const obj1StepSql = `'{"a": "1"}'::jsonb`
  const obj2StepSql = `'{"b": "2"}'::jsonb`
  const obj3StepSql = `'{"c": "3"}'::jsonb`
  const arrayOfObjs1Sql = `'[{"id": 1}]'::jsonb`
  const arrayOfObjs2Sql = `'[{"id": 2}]'::jsonb`

  describe('Object Merging', () => {
    it('merges two simple objects', () => {
      const obj1 = sql<{
        a: string
        b: number
      }>`${sql.raw(simpleObj1Sql)}`
      const obj2 = sql<{ b: number; c: boolean }>`${sql.raw(simpleObj2Sql)}`

      const result = jsonMerge(obj1, obj2)
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual([])
      expect(query.sql).toBe(
        `coalesce(${simpleObj1Sql}, 'null'::jsonb) || coalesce(${simpleObj2Sql}, 'null'::jsonb)`,
      )
    })

    it('handles object with nested properties', () => {
      const obj1 = sql<{
        user: { name: string }
      }>`${sql.raw(nestedObj1Sql)}`
      const obj2 = sql<{
        user: { age: number }
      }>`${sql.raw(nestedObj2Sql)}`

      const result = jsonMerge(obj1, obj2)
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual([])
      expect(query.sql).toBe(
        `coalesce(${nestedObj1Sql}, 'null'::jsonb) || coalesce(${nestedObj2Sql}, 'null'::jsonb)`,
      )
    })

    it('right object takes precedence on duplicate keys', () => {
      const obj1 = sql<{ key: string }>`${sql.raw(key1Sql)}`
      const obj2 = sql<{ key: string }>`${sql.raw(key2Sql)}`

      const result = jsonMerge(obj1, obj2)
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual([])
      expect(query.sql).toBe(
        `coalesce(${key1Sql}, 'null'::jsonb) || coalesce(${key2Sql}, 'null'::jsonb)`,
      )
      // The actual merging behavior is handled by PostgreSQL
    })
  })

  describe('Array Merging', () => {
    it('merges two arrays', () => {
      const arr1 = sql<string[]>`${sql.raw(stringArray1Sql)}`
      const arr2 = sql<string[]>`${sql.raw(stringArray2Sql)}`

      const result = jsonMerge(arr1, arr2)
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual([])
      expect(query.sql).toBe(
        `coalesce(${stringArray1Sql}, 'null'::jsonb) || coalesce(${stringArray2Sql}, 'null'::jsonb)`,
      )
    })

    it('merges arrays with different types', () => {
      const arr1 = sql<number[]>`${sql.raw(numberArray1Sql)}`
      const arr2 = sql<string[]>`${sql.raw(numberArray2Sql)}`

      const result = jsonMerge(arr1, arr2)
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual([])
      expect(query.sql).toBe(
        `coalesce(${numberArray1Sql}, 'null'::jsonb) || coalesce(${numberArray2Sql}, 'null'::jsonb)`,
      )
    })

    it('merges empty arrays', () => {
      const arr1 = sql<any[]>`${sql.raw(emptyArraySql)}`
      const arr2 = sql<string[]>`${sql.raw(arrayItemSql)}`

      const result = jsonMerge(arr1, arr2)
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual([])
      expect(query.sql).toBe(
        `coalesce(${emptyArraySql}, 'null'::jsonb) || coalesce(${arrayItemSql}, 'null'::jsonb)`,
      )
    })
  })

  describe('Mixed Type Merging', () => {
    it('merges array with non-array (appends to array)', () => {
      const arr = sql<number[]>`${sql.raw(numberArray1Sql)}`
      const value = sql<number>`${sql.raw(numberValueSql)}`

      const result = jsonMerge(arr, value)
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual([])
      expect(query.sql).toBe(
        `coalesce(${numberArray1Sql}, 'null'::jsonb) || coalesce(${numberValueSql}, 'null'::jsonb)`,
      )
    })

    it('merges non-array with array (prepends to array)', () => {
      const value = sql<number>`${sql.raw(numberValue1Sql)}`
      const arr = sql<number[]>`${sql.raw(arrayValue1Sql)}`

      const result = jsonMerge(value, arr)
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual([])
      expect(query.sql).toBe(
        `coalesce(${numberValue1Sql}, 'null'::jsonb) || coalesce(${arrayValue1Sql}, 'null'::jsonb)`,
      )
    })

    it('merges object with array (creates array)', () => {
      const obj = sql<{ a: string }>`${sql.raw(objValueSql)}`
      const arr = sql<number[]>`${sql.raw(array1Sql)}`

      const result = jsonMerge(obj, arr)
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual([])
      expect(query.sql).toBe(
        `coalesce(${objValueSql}, 'null'::jsonb) || coalesce(${array1Sql}, 'null'::jsonb)`,
      )
    })

    it('merges two primitive values (creates array)', () => {
      const val1 = sql<string>`${sql.raw(stringValueSql)}`
      const val2 = sql<number>`${sql.raw(numberValue42Sql)}`

      const result = jsonMerge(val1, val2)
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual([])
      expect(query.sql).toBe(
        `coalesce(${stringValueSql}, 'null'::jsonb) || coalesce(${numberValue42Sql}, 'null'::jsonb)`,
      )
    })
  })

  describe('Null Handling', () => {
    it('handles SQL NULL on left side', () => {
      const nullValue = sql`NULL::jsonb`
      const obj = sql<{ a: string }>`${sql.raw(objAValueSql)}`

      const result = jsonMerge(nullValue, obj)
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual([])
      expect(query.sql).toBe(
        `coalesce(NULL::jsonb, 'null'::jsonb) || coalesce(${objAValueSql}, 'null'::jsonb)`,
      )
    })

    it('handles SQL NULL on right side', () => {
      const obj = sql<{ a: string }>`${sql.raw(objAValueSql)}`
      const nullValue = sql`NULL::jsonb`

      const result = jsonMerge(obj, nullValue)
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual([])
      expect(query.sql).toBe(
        `coalesce(${objAValueSql}, 'null'::jsonb) || coalesce(NULL::jsonb, 'null'::jsonb)`,
      )
    })

    it('handles both sides as SQL NULL', () => {
      const nullValue1 = sql`NULL::jsonb`
      const nullValue2 = sql`NULL::jsonb`

      const result = jsonMerge(nullValue1, nullValue2)
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual([])
      expect(query.sql).toBe(
        `coalesce(NULL::jsonb, 'null'::jsonb) || coalesce(NULL::jsonb, 'null'::jsonb)`,
      )
    })

    it('handles JSON null (not SQL NULL)', () => {
      const jsonNull = sql`${sql.raw(nullJsonSql)}`
      const obj = sql<{ a: string }>`${sql.raw(objAValueSql)}`

      const result = jsonMerge(jsonNull, obj)
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual([])
      expect(query.sql).toBe(
        `coalesce(${nullJsonSql}, 'null'::jsonb) || coalesce(${objAValueSql}, 'null'::jsonb)`,
      )
    })
  })

  describe('Type Safety', () => {
    it('has correct return type for object merge', () => {
      const obj1 = sql<{ a: string }>`'{"a": "hello"}'::jsonb`
      const obj2 = sql<{ b: number }>`'{"b": 42}'::jsonb`

      const result = jsonMerge(obj1, obj2)
      expectTypeOf(result).toEqualTypeOf<SQL<{ a: string } & { b: number }>>()
    })

    it('has correct return type for array merge', () => {
      const arr1 = sql<string[]>`'["a"]'::jsonb`
      const arr2 = sql<string[]>`'["b"]'::jsonb`

      const result = jsonMerge(arr1, arr2)
      expectTypeOf(result).toEqualTypeOf<SQL<string[] & string[]>>()
    })

    it('has correct return type for mixed merge', () => {
      const obj = sql<{ a: string }>`'{"a": "hello"}'::jsonb`
      const arr = sql<number[]>`'[1, 2]'::jsonb`

      const result = jsonMerge(obj, arr)
      expectTypeOf(result).toEqualTypeOf<
        SQL<
          [
            {
              a: string
            },
            ...number[],
          ]
        >
      >()
    })

    it('handles complex nested object merge types', () => {
      const obj1 = sql<{
        user: { name: string }
      }>`'{"user": {"name": "John"}}'::jsonb`

      const obj2 = sql<{
        user: { age: number }
        config: { theme: string }
      }>`'{"user": {"age": 30}, "config": {"theme": "dark"}}'::jsonb`

      const result = jsonMerge(obj1, obj2)
      expectTypeOf(result).toEqualTypeOf<
        SQL<
          { user: { name: string } } & {
            user: { age: number }
            config: { theme: string }
          }
        >
      >()
    })
  })

  describe('Complex Merging Scenarios', () => {
    it('merges deeply nested objects', () => {
      const obj1 = sql<{
        user: {
          profile: {
            settings: { theme: string }
          }
        }
      }>`${sql.raw(deepNestedObj1Sql)}`

      const obj2 = sql<{
        user: {
          profile: {
            settings: { language: string }
          }
        }
      }>`${sql.raw(deepNestedObj2Sql)}`

      const result = jsonMerge(obj1, obj2)
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual([])
      expect(query.sql).toBe(
        `coalesce(${deepNestedObj1Sql}, 'null'::jsonb) || coalesce(${deepNestedObj2Sql}, 'null'::jsonb)`,
      )
    })

    it('chains multiple merge operations', () => {
      const obj1 = sql<{ a: string }>`${sql.raw(obj1StepSql)}`
      const obj2 = sql<{ b: string }>`${sql.raw(obj2StepSql)}`
      const obj3 = sql<{ c: string }>`${sql.raw(obj3StepSql)}`

      const step1 = jsonMerge(obj1, obj2)
      const result = jsonMerge(step1, obj3)
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual([])
      expect(query.sql).toBe(
        `coalesce(coalesce(${obj1StepSql}, 'null'::jsonb) || coalesce(${obj2StepSql}, 'null'::jsonb), 'null'::jsonb) || coalesce(${obj3StepSql}, 'null'::jsonb)`,
      )
      expect(query.sql.split('||').length).toBeGreaterThan(2)
    })

    it('merges arrays of objects', () => {
      const arr1 = sql<Array<{ id: number }>>`${sql.raw(arrayOfObjs1Sql)}`
      const arr2 = sql<Array<{ id: number }>>`${sql.raw(arrayOfObjs2Sql)}`

      const result = jsonMerge(arr1, arr2)
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual([])
      expect(query.sql).toBe(
        `coalesce(${arrayOfObjs1Sql}, 'null'::jsonb) || coalesce(${arrayOfObjs2Sql}, 'null'::jsonb)`,
      )
    })
  })

  describe('SQL Generation Details', () => {
    it('generates inline parameters correctly', () => {
      const obj1Sql = `'{"a": "hello"}'::jsonb`
      const obj2Sql = `'{"b": 42}'::jsonb`
      const obj1 = sql<{ a: string }>`${sql.raw(obj1Sql)}`
      const obj2 = sql<{ b: number }>`${sql.raw(obj2Sql)}`

      const result = jsonMerge(obj1, obj2)
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual([])
      expect(query.sql).toBe(
        `coalesce(${obj1Sql}, 'null'::jsonb) || coalesce(${obj2Sql}, 'null'::jsonb)`,
      )
    })

    it('preserves original SQL structure in merge', () => {
      const complexLeft = sql`jsonb_build_object('dynamic', ${'value'})`
      const complexRight = sql`jsonb_build_object('other', ${'data'})`

      const result = jsonMerge(complexLeft, complexRight)
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual(['value', 'data'])
      expect(query.sql).toBe(
        `coalesce(jsonb_build_object('dynamic', $1), 'null'::jsonb) || coalesce(jsonb_build_object('other', $2), 'null'::jsonb)`,
      )
    })
  })

  describe('Table Column Integration', () => {
    it('should work with table columns for merging objects', () => {
      const additionalData = sql<{ some: 'json' }>`'{"some": "json"}'::jsonb`
      const mergeResult = jsonMerge(table.jsoncol, additionalData)
      const query = dialect.sqlToQuery(mergeResult)

      expect(query.params).toEqual([])
      expect(query.sql).toBe(
        `coalesce("test"."jsoncol", 'null'::jsonb) || coalesce('{"some": "json"}'::jsonb, 'null'::jsonb)`,
      )
    })

    it('should work with table columns merging with plain objects', () => {
      const additionalData = sql<{ some: 'json' }>`'{"some": "json"}'::jsonb`
      const mergeResult = jsonMerge(table.jsoncol, additionalData)
      const query = dialect.sqlToQuery(mergeResult)

      expect(query.params).toEqual([])
      expect(query.sql).toBe(
        `coalesce("test"."jsoncol", 'null'::jsonb) || coalesce('{"some": "json"}'::jsonb, 'null'::jsonb)`,
      )
    })
  })
})
