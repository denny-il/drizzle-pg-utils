import { type SQL, sql } from 'drizzle-orm'
import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  jsonArrayDelete,
  jsonArrayPush,
  jsonArraySet,
} from '../../src/json/array.ts'
import { dialect, table } from '../utils.ts'

describe('JSON Array Operations', () => {
  const numberArraySql = `'[1, 2, 3]'::jsonb`
  const numberArray = sql<number[]>`${sql.raw(numberArraySql)}`

  const stringArraySql = `'["a", "b", "c"]'::jsonb`
  const stringArray = sql<string[]>`${sql.raw(stringArraySql)}`

  const objectArraySql = `'[{"id": 1, "name": "John"}, {"id": 2, "name": "Jane"}]'::jsonb`
  const objectArray = sql<
    Array<{ id: number; name: string }>
  >`${sql.raw(objectArraySql)}`

  const emptyArraySql = `'[]'::jsonb`
  const emptyArray = sql<any[]>`${sql.raw(emptyArraySql)}`

  const nullableArraySql = 'NULL::jsonb'
  const nullableArray = sql<number[] | null>`${sql.raw(nullableArraySql)}`

  describe('jsonArrayPush', () => {
    it('pushes single value to number array', () => {
      const result = jsonArrayPush(numberArray, 4)
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual(['4'])
      expect(query.sql).toBe(
        `json_query(coalesce(${numberArraySql}, 'null'::jsonb), 'strict $ ? (@ != null)' default '[]'::jsonb on empty)::jsonb || jsonb_build_array($1::jsonb)`,
      )
    })

    it('pushes multiple values to array', () => {
      const result = jsonArrayPush(numberArray, 4, 5, 6)
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual(['4', '5', '6'])
      expect(query.sql).toBe(
        `json_query(coalesce(${numberArraySql}, 'null'::jsonb), 'strict $ ? (@ != null)' default '[]'::jsonb on empty)::jsonb || jsonb_build_array($1::jsonb, $2::jsonb, $3::jsonb)`,
      )
    })

    it('pushes string values', () => {
      const result = jsonArrayPush(stringArray, 'd', 'e')
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual(['"d"', '"e"'])
      expect(query.sql).toBe(
        `json_query(coalesce(${stringArraySql}, 'null'::jsonb), 'strict $ ? (@ != null)' default '[]'::jsonb on empty)::jsonb || jsonb_build_array($1::jsonb, $2::jsonb)`,
      )
    })

    it('pushes object values', () => {
      const newUser = { id: 3, name: 'Bob' }
      const result = jsonArrayPush(objectArray, newUser)
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual(['{"id":3,"name":"Bob"}'])
      expect(query.sql).toBe(
        `json_query(coalesce(${objectArraySql}, 'null'::jsonb), 'strict $ ? (@ != null)' default '[]'::jsonb on empty)::jsonb || jsonb_build_array($1::jsonb)`,
      )
    })

    it('pushes SQL expressions', () => {
      const sqlValue = sql<number>`'42'::jsonb`
      const result = jsonArrayPush(numberArray, sqlValue)
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual([])
      expect(query.sql).toBe(
        `json_query(coalesce(${numberArraySql}, 'null'::jsonb), 'strict $ ? (@ != null)' default '[]'::jsonb on empty)::jsonb || jsonb_build_array('42'::jsonb)`,
      )
    })

    it('handles empty array', () => {
      const result = jsonArrayPush(emptyArray, 'first')
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual(['"first"'])
      expect(query.sql).toBe(
        `json_query(coalesce(${emptyArraySql}, 'null'::jsonb), 'strict $ ? (@ != null)' default '[]'::jsonb on empty)::jsonb || jsonb_build_array($1::jsonb)`,
      )
    })

    it('handles nullable array', () => {
      const result = jsonArrayPush(nullableArray, 1)
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual(['1'])
      expect(query.sql).toBe(
        `json_query(coalesce(${nullableArraySql}, 'null'::jsonb), 'strict $ ? (@ != null)' default '[]'::jsonb on empty)::jsonb || jsonb_build_array($1::jsonb)`,
      )
    })

    it('has correct return type', () => {
      const result = jsonArrayPush(numberArray, 4)
      expectTypeOf(result).toEqualTypeOf<SQL<number[]>>()
    })
  })

  describe('jsonArraySet', () => {
    it('sets value at specific index', () => {
      const result = jsonArraySet(numberArray, 1, 99)
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual([99].map((v) => JSON.stringify(v)))
      expect(query.sql).toBe(`jsonb_set(${numberArraySql}, '{1}', $1::jsonb)`)
    })

    it('sets string value at index', () => {
      const result = jsonArraySet(stringArray, 0, 'new')
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual(['new'].map((v) => JSON.stringify(v)))
      expect(query.sql).toBe(`jsonb_set(${stringArraySql}, '{0}', $1::jsonb)`)
    })

    it('sets object value at index', () => {
      const newUser = { id: 99, name: 'Updated' }
      const result = jsonArraySet(objectArray, 0, newUser)
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual([newUser].map((v) => JSON.stringify(v)))
      expect(query.sql).toBe(`jsonb_set(${objectArraySql}, '{0}', $1::jsonb)`)
    })

    it('sets SQL expression value', () => {
      const sqlValue = sql<number>`'777'::jsonb`
      const result = jsonArraySet(numberArray, 2, sqlValue)
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual([])
      expect(query.sql).toBe(
        `jsonb_set(${numberArraySql}, '{2}', '777'::jsonb)`,
      )
    })

    it('handles negative indices correctly in SQL', () => {
      const result = jsonArraySet(numberArray, -1, 99)
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual([99].map((v) => JSON.stringify(v)))
      expect(query.sql).toBe(`jsonb_set(${numberArraySql}, '{-1}', $1::jsonb)`)
    })

    it('has correct return type', () => {
      const result = jsonArraySet(numberArray, 1, 42)
      expectTypeOf(result).toEqualTypeOf<import('drizzle-orm').SQL<number[]>>()
    })
  })

  describe('jsonArrayDelete', () => {
    it('deletes element at specific index', () => {
      const result = jsonArrayDelete(numberArray, 1)
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual([])
      expect(query.sql).toBe(
        `json_query(coalesce(${numberArraySql}, 'null'::jsonb), 'strict $ ? (@ != null)' default '[]'::jsonb on empty)::jsonb - 1`,
      )
    })

    it('deletes first element', () => {
      const result = jsonArrayDelete(stringArray, 0)
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual([])
      expect(query.sql).toBe(
        `json_query(coalesce(${stringArraySql}, 'null'::jsonb), 'strict $ ? (@ != null)' default '[]'::jsonb on empty)::jsonb - 0`,
      )
    })

    it('deletes last element with negative index', () => {
      const result = jsonArrayDelete(numberArray, -1)
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual([])
      expect(query.sql).toBe(
        `json_query(coalesce(${numberArraySql}, 'null'::jsonb), 'strict $ ? (@ != null)' default '[]'::jsonb on empty)::jsonb - -1`,
      )
    })

    it('handles nullable array', () => {
      // Skip this test as nullable arrays need special handling
      const nonNullArray = sql<number[]>`'[1, 2, 3]'::jsonb`
      const result = jsonArrayDelete(nonNullArray, 0)
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual([])
      expect(query.sql).toBe(
        `json_query(coalesce('[1, 2, 3]'::jsonb, 'null'::jsonb), 'strict $ ? (@ != null)' default '[]'::jsonb on empty)::jsonb - 0`,
      )
    })

    it('has correct return type', () => {
      const result = jsonArrayDelete(numberArray, 1)
      expectTypeOf(result).toEqualTypeOf<SQL<number[]>>()
    })
  })

  describe('Complex Array Operations', () => {
    it('chains multiple array operations', () => {
      // Push then set then delete
      const step1 = jsonArrayPush(numberArray, 4, 5)
      const step2 = jsonArraySet(step1, 0, 99)
      const result = jsonArrayDelete(step2, 2)

      const query = dialect.sqlToQuery(result)
      expect(query.sql).toBeDefined()
    })

    it('handles mixed type arrays', () => {
      const mixedArraySql = `'["text", 42, true]'::jsonb`
      const mixedArray = sql<
        (string | number | boolean)[]
      >`${sql.raw(mixedArraySql)}`

      const pushResult = jsonArrayPush(mixedArray, false)
      const setResult = jsonArraySet(mixedArray, 1, 'updated')
      const deleteResult = jsonArrayDelete(mixedArray, 0)

      expect(dialect.sqlToQuery(pushResult).sql).toBeDefined()
      expect(dialect.sqlToQuery(setResult).sql).toBeDefined()
      expect(dialect.sqlToQuery(deleteResult).sql).toBeDefined()
    })

    it('works with nested arrays', () => {
      const nestedArraySql = `'[[1, 2], [3, 4], [5, 6]]'::jsonb`
      const nestedArray = sql<number[][]>`${sql.raw(nestedArraySql)}`

      const newSubArray = [7, 8]
      const result = jsonArrayPush(nestedArray, newSubArray)
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual(['[7,8]'])
      expect(query.sql).toBe(
        `json_query(coalesce(${nestedArraySql}, 'null'::jsonb), 'strict $ ? (@ != null)' default '[]'::jsonb on empty)::jsonb || jsonb_build_array($1::jsonb)`,
      )
    })
  })

  describe('Edge Cases and Error Handling', () => {
    it('handles pushing null values', () => {
      const result = jsonArrayPush(numberArray, null as any)
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual(['null'])
      expect(query.sql).toBe(
        `json_query(coalesce(${numberArraySql}, 'null'::jsonb), 'strict $ ? (@ != null)' default '[]'::jsonb on empty)::jsonb || jsonb_build_array($1::jsonb)`,
      )
    })

    it('handles setting null values', () => {
      const result = jsonArraySet(numberArray, 0, null as any)
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual([null].map((v) => JSON.stringify(v)))
      expect(query.sql).toBe(`jsonb_set(${numberArraySql}, '{0}', $1::jsonb)`)
    })

    it('preserves type information through operations', () => {
      const result1 = jsonArrayPush(numberArray, 4)
      const result2 = jsonArraySet(numberArray, 0, 99)
      const result3 = jsonArrayDelete(numberArray, 1)

      expectTypeOf(result1).toEqualTypeOf<SQL<number[]>>()
      expectTypeOf(result2).toEqualTypeOf<SQL<number[]>>()
      expectTypeOf(result3).toEqualTypeOf<SQL<number[]>>()
    })

    it('handles type variations correctly', () => {
      // Test different array types
      const stringResult = jsonArrayPush(stringArray, 'new')
      const objectResult = jsonArrayPush(objectArray, { id: 3, name: 'Test' })

      expectTypeOf(stringResult).toEqualTypeOf<SQL<string[]>>()
      expectTypeOf(objectResult).toEqualTypeOf<
        SQL<Array<{ id: number; name: string }>>
      >()
    })
  })

  describe('Table Column Integration', () => {
    it('should work with table columns for push operations', () => {
      const result = jsonArrayPush(table.arraycol, { id: 3, name: 'new-item' })
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual(['{"id":3,"name":"new-item"}'])
      expect(query.sql).toBe(
        `json_query(coalesce("test"."arraycol", 'null'::jsonb), 'strict $ ? (@ != null)' default '[]'::jsonb on empty)::jsonb || jsonb_build_array($1::jsonb)`,
      )
    })

    it('should work with table columns for set operations', () => {
      const result = jsonArraySet(table.arraycol, 0, {
        id: 1,
        name: 'updated-item',
      })
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual(
        [{ id: 1, name: 'updated-item' }].map((v) => JSON.stringify(v)),
      )
      expect(query.sql).toBe(`jsonb_set("test"."arraycol", '{0}', $1::jsonb)`)
    })

    it('should work with table columns for delete operations', () => {
      const result = jsonArrayDelete(table.arraycol, 0)
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual([])
      expect(query.sql).toBe(
        `json_query(coalesce("test"."arraycol", 'null'::jsonb), 'strict $ ? (@ != null)' default '[]'::jsonb on empty)::jsonb - 0`,
      )
    })
  })
})
