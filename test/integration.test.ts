import { sql } from 'drizzle-orm'
import type { PgliteDatabase } from 'drizzle-orm/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { jsonAccessor } from '../src/json/access.ts'
import {
  jsonArrayDelete,
  jsonArrayPush,
  jsonArraySet,
} from '../src/json/array.ts'
import { jsonMerge } from '../src/json/merge.ts'
import { jsonSet } from '../src/json/set.ts'
import { createDatabase, executeQuery } from './utils.ts'

let db: PgliteDatabase

beforeAll(async () => {
  db = await createDatabase()
})

describe('JSON Integration Tests', () => {
  describe('JSON Accessor Runtime Behavior', () => {
    it('should access nested properties correctly', async () => {
      const value = sql<{
        user: { id: number; name: string }
      }>`'{"user": {"id": 123, "name": "John"}}'::jsonb`
      const userId = jsonAccessor(value).user.id.$path
      const userName = jsonAccessor(value).user.name.$path

      const idResult = await executeQuery(db, userId)
      const nameResult = await executeQuery(db, userName)

      expect(idResult).toEqual(123)
      expect(nameResult).toEqual('John')
    })

    it('should handle JSON null vs SQL NULL correctly', async () => {
      // JSON with explicit null value
      const jsonWithNull = sql<{
        value: string | null
      }>`'{"value": null}'::jsonb`
      const jsonNullResult = jsonAccessor(jsonWithNull).value.$path

      // SQL NULL
      const sqlNull = sql<{ value: string | null }>`NULL::jsonb`
      const sqlNullResult = jsonAccessor(sqlNull).value.$path

      const jsonNullValue = await executeQuery(db, jsonNullResult)
      const sqlNullValue = await executeQuery(db, sqlNullResult)

      // JSON null becomes SQL NULL when extracted
      expect(jsonNullValue).toBeNull()
      expect(sqlNullValue).toBeNull()
    })

    it('should handle missing properties as SQL NULL', async () => {
      const value = sql<{
        user: { name: string; age?: number }
      }>`'{"user": {"name": "John"}}'::jsonb`
      const missingAge = jsonAccessor(value).user.age.$path
      const existingName = jsonAccessor(value).user.name.$path

      const ageResult = await executeQuery(db, missingAge)
      const nameResult = await executeQuery(db, existingName)

      expect(ageResult).toBeNull()
      expect(nameResult).toEqual('John')
    })

    it('should handle deeply nested missing properties', async () => {
      const value = sql<{ a: { b: { c: string } } }>`'{"a": {"b": {}}}'::jsonb`
      const missing = jsonAccessor(value).a.b.c.$path

      const missingResult = await executeQuery(db, missing)

      expect(missingResult).toBeNull()
    })

    it('should access array elements through accessor pattern', async () => {
      const value = sql<{
        tags: string[]
        numbers: number[]
      }>`'{"tags": ["typescript", "postgres"], "numbers": [1, 2, 3]}'::jsonb`

      // Access array elements using proper accessor pattern
      const accessor = jsonAccessor(value)
      const firstTag = accessor.tags['0'].$path
      const secondNumber = accessor.numbers['1'].$path
      const outOfBounds = accessor.tags['10'].$path

      const firstTagResult = await executeQuery(db, firstTag)
      const secondNumberResult = await executeQuery(db, secondNumber)
      const outOfBoundsResult = await executeQuery(db, outOfBounds)

      expect(firstTagResult).toEqual('typescript')
      expect(secondNumberResult).toEqual(2)
      expect(outOfBoundsResult).toBeNull()
    })

    it('should handle complex nested objects with mixed types', async () => {
      const complexValue = sql<{
        user: {
          id: number
          profile: {
            settings: {
              theme: 'light' | 'dark'
              notifications: boolean
            }
          } | null
        }
        metadata: { version: string } | null
      }>`'{"user": {"id": 42, "profile": {"settings": {"theme": "dark", "notifications": true}}}, "metadata": null}'::jsonb`

      const userId = jsonAccessor(complexValue).user.id.$path
      const theme = jsonAccessor(complexValue).user.profile.settings.theme.$path
      const notifications =
        jsonAccessor(complexValue).user.profile.settings.notifications.$path
      const metadata = jsonAccessor(complexValue).metadata.$path

      const userIdResult = await executeQuery(db, userId)
      const themeResult = await executeQuery(db, theme)
      const notificationsResult = await executeQuery(db, notifications)
      const metadataResult = await executeQuery(db, metadata)

      expect(userIdResult).toEqual(42)
      expect(themeResult).toEqual('dark')
      expect(notificationsResult).toEqual(true)
      expect(metadataResult).toBeNull() // JSON null becomes SQL NULL
    })
  })

  describe('JSON Set Runtime Behavior', () => {
    it('should set simple properties with basic types', async () => {
      const baseValue = sql<{
        name: string
        age: number
      }>`'{"name": "John", "age": 30}'::jsonb`
      const setter = jsonSet(baseValue)
      const result = await executeQuery(
        db,
        setter.$set({ name: 'Jane', age: 25 }),
      )

      expect(result).toEqual({ name: 'Jane', age: 25 })
    })

    it('should set nested properties', async () => {
      const baseValue = sql<{
        user: { id: number; profile: { name: string } }
      }>`'{"user": {"id": 1, "profile": {"name": "John"}}}'::jsonb`
      const setter = jsonSet(baseValue)
      const result = await executeQuery(
        db,
        setter.$set({
          user: {
            id: 1,
            profile: {
              name: 'Updated John',
            },
          },
        }),
      )

      expect(result).toEqual({
        user: {
          id: 1,
          profile: {
            name: 'Updated John',
          },
        },
      })
    })

    it('should handle setting on NULL base with createMissing', async () => {
      const nullBase = sql<{ user: { name: string } } | null>`NULL::jsonb`
      const setter = jsonSet(nullBase)
      const result = await executeQuery(
        db,
        setter.$set({ user: { name: 'New User' } }, true),
      )

      expect(result).toEqual({ user: { name: 'New User' } })
    })
  })

  describe('JSON Merge Runtime Behavior', () => {
    it('should merge objects correctly', async () => {
      const base = sql<{
        a: number
        b: string
      }>`'{"a": 1, "b": "hello"}'::jsonb`
      const toMerge = sql<{
        b: string
        c: boolean
      }>`'{"b": "world", "c": true}'::jsonb`
      const merged = jsonMerge(base, toMerge)
      const result = await executeQuery(db, merged)

      expect(result).toEqual({ a: 1, b: 'world', c: true })
    })

    it('should merge with null values', async () => {
      const base = sql<{
        a: number
        b: string | null
      }>`'{"a": 1, "b": null}'::jsonb`
      const toMerge = sql<{
        b: string
        c: number
      }>`'{"b": "replaced", "c": 42}'::jsonb`
      const merged = jsonMerge(base, toMerge)
      const result = await executeQuery(db, merged)

      expect(result).toEqual({ a: 1, b: 'replaced', c: 42 })
    })

    it('should handle merging arrays', async () => {
      const base = sql<number[]>`'[1, 2, 3]'::jsonb`
      const toMerge = sql<number[]>`'[4, 5]'::jsonb`
      const merged = jsonMerge(base, toMerge)
      const result = await executeQuery(db, merged)

      expect(result).toEqual([1, 2, 3, 4, 5])
    })

    it('should merge array with non-array', async () => {
      const base = sql<number[]>`'[1, 2]'::jsonb`
      const toMerge = sql<number>`'3'::jsonb`
      const merged = jsonMerge(base, toMerge)
      const result = await executeQuery(db, merged)

      expect(result).toEqual([1, 2, 3])
    })
  })

  describe('JSON Array Operations Runtime Behavior', () => {
    it('should push elements to arrays', async () => {
      const baseArray = sql<string[]>`'["a", "b"]'::jsonb`
      const pushedArray = jsonArrayPush(baseArray, 'c')
      const result = await executeQuery(db, pushedArray)

      expect(result).toEqual(['a', 'b', 'c'])
    })

    it('should push multiple elements', async () => {
      const baseArray = sql<string[]>`'["a"]'::jsonb`
      const pushed1 = jsonArrayPush(baseArray, 'b')
      const pushed2 = jsonArrayPush(pushed1, 'c')
      const result = await executeQuery(db, pushed2)

      expect(result).toEqual(['a', 'b', 'c'])
    })

    it('should set array elements by index', async () => {
      const baseArray = sql<string[]>`'["a", "b", "c"]'::jsonb`
      const updatedArray = jsonArraySet(baseArray, 1, 'updated')
      const result = await executeQuery(db, updatedArray)

      expect(result).toEqual(['a', 'updated', 'c'])
    })

    it('should delete array elements by index', async () => {
      const baseArray = sql<string[]>`'["a", "b", "c", "d"]'::jsonb`
      const deletedArray = jsonArrayDelete(baseArray, 2)
      const result = await executeQuery(db, deletedArray)

      expect(result).toEqual(['a', 'b', 'd'])
    })

    it('should handle out-of-bounds array operations gracefully', async () => {
      const baseArray = sql<string[]>`'["a", "b"]'::jsonb`

      // Set out of bounds - PostgreSQL jsonb_set doesn't extend with nulls like I expected
      const extendedArray = jsonArraySet(baseArray, 5, 'far')
      const extendedResult = await executeQuery(db, extendedArray)

      // Delete out of bounds (should be no-op)
      const deleteOutOfBounds = jsonArrayDelete(baseArray, 10)
      const deleteResult = await executeQuery(db, deleteOutOfBounds)

      // PostgreSQL behavior: setting out of bounds just appends at the end
      expect(extendedResult).toEqual(['a', 'b', 'far'])
      expect(deleteResult).toEqual(['a', 'b'])
    })

    it('should push SQL expressions', async () => {
      const baseArray = sql<number[]>`'[1, 2]'::jsonb`
      const sqlValue = sql<number>`'42'::jsonb`
      const pushedArray = jsonArrayPush(baseArray, sqlValue)
      const result = await executeQuery(db, pushedArray)

      expect(result).toEqual([1, 2, 42])
    })
  })

  describe('Edge Cases and Type Safety', () => {
    it('should handle numeric type coercion', async () => {
      const numericData = sql<{
        int: number
        float: number
        zero: number
        negative: number
      }>`'{"int": 42, "float": 3.14, "zero": 0, "negative": -123}'::jsonb`

      const intValue = jsonAccessor(numericData).int.$path
      const floatValue = jsonAccessor(numericData).float.$path
      const zeroValue = jsonAccessor(numericData).zero.$path
      const negativeValue = jsonAccessor(numericData).negative.$path

      const intResult = await executeQuery(db, intValue)
      const floatResult = await executeQuery(db, floatValue)
      const zeroResult = await executeQuery(db, zeroValue)
      const negativeResult = await executeQuery(db, negativeValue)

      expect(intResult).toEqual(42)
      expect(floatResult).toEqual(3.14)
      expect(zeroResult).toEqual(0)
      expect(negativeResult).toEqual(-123)
    })

    it('should handle boolean type coercion', async () => {
      const booleanData = sql<{
        true: boolean
        false: boolean
      }>`'{"true": true, "false": false}'::jsonb`

      const trueValue = jsonAccessor(booleanData).true.$path
      const falseValue = jsonAccessor(booleanData).false.$path

      const trueResult = await executeQuery(db, trueValue)
      const falseResult = await executeQuery(db, falseValue)

      expect(trueResult).toEqual(true)
      expect(falseResult).toEqual(false)
    })

    it('should handle string edge cases', async () => {
      const stringData = sql<{
        empty: string
        spaces: string
        unicode: string
        escaped: string
      }>`'{"empty": "", "spaces": "   ", "unicode": "🚀", "escaped": "quote\\"test"}'::jsonb`

      const emptyValue = jsonAccessor(stringData).empty.$path
      const spacesValue = jsonAccessor(stringData).spaces.$path
      const unicodeValue = jsonAccessor(stringData).unicode.$path
      const escapedValue = jsonAccessor(stringData).escaped.$path

      const emptyResult = await executeQuery(db, emptyValue)
      const spacesResult = await executeQuery(db, spacesValue)
      const unicodeResult = await executeQuery(db, unicodeValue)
      const escapedResult = await executeQuery(db, escapedValue)

      expect(emptyResult).toEqual('')
      expect(spacesResult).toEqual('   ')
      expect(unicodeResult).toEqual('🚀')
      expect(escapedResult).toEqual('quote"test')
    })

    it('should handle deeply nested null propagation', async () => {
      const deepData = sql<{
        level1: {
          level2: {
            level3: {
              value: string | null
            } | null
          } | null
        } | null
      }>`'{"level1": {"level2": {"level3": null}}}'::jsonb`

      const deepValue = jsonAccessor(deepData).level1.level2.level3.value.$path
      const result = await executeQuery(db, deepValue)

      expect(result).toBeNull()
    })

    it('should maintain type safety with union types', async () => {
      const unionData = sql<{
        status: 'active' | 'inactive' | 'pending'
        count: number | null
      }>`'{"status": "active", "count": null}'::jsonb`

      const statusValue = jsonAccessor(unionData).status.$path
      const countValue = jsonAccessor(unionData).count.$path

      const statusResult = await executeQuery(db, statusValue)
      const countResult = await executeQuery(db, countValue)

      expect(statusResult).toEqual('active')
      expect(countResult).toBeNull()
    })

    it('should handle large integers correctly', async () => {
      const largeNumbers = sql<{
        maxSafeInt: number
        largeBigInt: number
        scientific: number
      }>`'{"maxSafeInt": 9007199254740991, "largeBigInt": 9007199254740991, "scientific": 1.23e10}'::jsonb`

      const maxSafeResult = await executeQuery(
        db,
        jsonAccessor(largeNumbers).maxSafeInt.$path,
      )
      const largeBigIntResult = await executeQuery(
        db,
        jsonAccessor(largeNumbers).largeBigInt.$path,
      )
      const scientificResult = await executeQuery(
        db,
        jsonAccessor(largeNumbers).scientific.$path,
      )

      expect(maxSafeResult).toEqual(9007199254740991)
      expect(largeBigIntResult).toEqual(9007199254740991) // Using max safe integer instead
      expect(scientificResult).toEqual(12300000000)
    })

    it('should handle arrays with mixed types', async () => {
      const mixedArray = sql<{
        mixed: (string | number | boolean | null)[]
      }>`'{"mixed": ["string", 42, true, null, false, 0]}'::jsonb`

      // Access individual array elements using proper accessor pattern
      const accessor = jsonAccessor(mixedArray)

      const results = await Promise.all([
        executeQuery(db, accessor.mixed['0'].$path),
        executeQuery(db, accessor.mixed['1'].$path),
        executeQuery(db, accessor.mixed['2'].$path),
        executeQuery(db, accessor.mixed['3'].$path),
        executeQuery(db, accessor.mixed['4'].$path),
        executeQuery(db, accessor.mixed['5'].$path),
      ])

      expect(results[0]).toEqual('string')
      expect(results[1]).toEqual(42)
      expect(results[2]).toEqual(true)
      expect(results[3]).toBeNull() // JSON null becomes SQL NULL via $path
      expect(results[4]).toEqual(false)
      expect(results[5]).toEqual(0)
    })

    it('should handle empty objects and arrays', async () => {
      const emptyData = sql<{
        emptyObj: Record<string, never>
        emptyArray: never[]
        objWithEmpty: { empty: Record<string, never> }
      }>`'{"emptyObj": {}, "emptyArray": [], "objWithEmpty": {"empty": {}}}'::jsonb`

      const emptyObjResult = await executeQuery(
        db,
        jsonAccessor(emptyData).emptyObj.$path,
      )
      const emptyArrayResult = await executeQuery(
        db,
        jsonAccessor(emptyData).emptyArray.$path,
      )
      const nestedEmptyResult = await executeQuery(
        db,
        jsonAccessor(emptyData).objWithEmpty.empty.$path,
      )

      expect(emptyObjResult).toEqual({})
      expect(emptyArrayResult).toEqual([])
      expect(nestedEmptyResult).toEqual({})
    })

    it('should verify $value vs $path behavior difference', async () => {
      const testData = sql<{
        user: { name: string; count: number }
      }>`'{"user": {"name": "test", "count": 42}}'::jsonb`

      // $path returns the actual JSON value
      const nameViaPath = await executeQuery(
        db,
        jsonAccessor(testData).user.name.$path,
      )
      const countViaPath = await executeQuery(
        db,
        jsonAccessor(testData).user.count.$path,
      )

      // $value should extract as text (all return strings)
      const nameViaValue = await executeQuery(
        db,
        jsonAccessor(testData).user.name.$value,
      )
      const countViaValue = await executeQuery(
        db,
        jsonAccessor(testData).user.count.$value,
      )

      // $path preserves types
      expect(nameViaPath).toEqual('test')
      expect(countViaPath).toEqual(42)

      // $value extracts as text
      expect(nameViaValue).toEqual('test')
      expect(countViaValue).toEqual('42') // String, not number
    })
  })

  describe('Complex Integration Scenarios', () => {
    it('should handle chained array operations', async () => {
      // Start with a base array and perform multiple operations
      const baseArray = sql<string[]>`'["initial"]'::jsonb`

      // Chain multiple array operations using jsonArrayPush, jsonArraySet, jsonArrayDelete
      const step1 = jsonArrayPush(baseArray, 'second')
      const step2 = jsonArrayPush(step1, 'third', 'fourth')
      const step3 = jsonArraySet(step2, 1, 'updated-second')
      const step4 = jsonArrayDelete(step3, 3) // Remove 'fourth'
      const finalResult = jsonArrayPush(step4, 'final')

      const result = await executeQuery(db, finalResult)
      expect(result).toEqual(['initial', 'updated-second', 'third', 'final'])
    })

    it('should jsonMerge for object updates', async () => {
      const userData = sql<{
        user: { name: string; tags: string[] }
        status: string
      }>`'{"user": {"name": "John", "tags": ["beginner"]}, "status": "active"}'::jsonb`

      // Create a new user object with updated tags and merge it
      const newUserData = sql<{
        user: { name: string; tags: string[] }
      }>`'{"user": {"name": "John", "tags": ["beginner", "developer", "typescript"]}}'::jsonb`
      const mergedResult = jsonMerge(userData, newUserData)

      const result = await executeQuery(db, mergedResult)

      expect(result.user.tags).toEqual(['beginner', 'developer', 'typescript'])
      expect(result.status).toBe('active')
    })

    it('should use jsonArraySet and jsonArrayDelete together', async () => {
      const items = sql<
        string[]
      >`'["first", "second", "third", "fourth", "fifth"]'::jsonb`

      // Update middle item using jsonArraySet
      const withUpdate = jsonArraySet(items, 2, 'UPDATED')

      // Remove first and last items using jsonArrayDelete
      const withoutFirst = jsonArrayDelete(withUpdate, 0)
      const withoutLast = jsonArrayDelete(withoutFirst, 3) // index shifts after first deletion

      const result = await executeQuery(db, withoutLast)
      expect(result).toEqual(['second', 'UPDATED', 'fourth'])
    })

    it('should test jsonAccessor with complex nested access patterns', async () => {
      const complexData = sql<{
        app: {
          modules: {
            auth: { enabled: boolean; providers: string[] }
            db: { host: string; connections: number[] }
          }
          metadata: { version: string; build: number }
        }
      }>`'{"app": {"modules": {"auth": {"enabled": true, "providers": ["google", "github"]}, "db": {"host": "localhost", "connections": [1, 2, 3]}}, "metadata": {"version": "1.0.0", "build": 123}}}'::jsonb`

      // Use jsonAccessor to access deeply nested values
      const authEnabled =
        jsonAccessor(complexData).app.modules.auth.enabled.$path
      const firstProvider =
        jsonAccessor(complexData).app.modules.auth.providers['0'].$path
      const dbHost = jsonAccessor(complexData).app.modules.db.host.$path
      const firstConnection =
        jsonAccessor(complexData).app.modules.db.connections['0'].$path
      const version = jsonAccessor(complexData).app.metadata.version.$path
      const buildNumber = jsonAccessor(complexData).app.metadata.build.$path

      const results = await Promise.all([
        executeQuery(db, authEnabled),
        executeQuery(db, firstProvider),
        executeQuery(db, dbHost),
        executeQuery(db, firstConnection),
        executeQuery(db, version),
        executeQuery(db, buildNumber),
      ])

      expect(results[0]).toBe(true)
      expect(results[1]).toBe('google')
      expect(results[2]).toBe('localhost')
      expect(results[3]).toBe(1)
      expect(results[4]).toBe('1.0.0')
      expect(results[5]).toBe(123)
    })

    it('should demonstrate jsonMerge with different data types', async () => {
      const base1 = sql<{
        a: number
        b: string
      }>`'{"a": 1, "b": "hello"}'::jsonb`
      const overlay1 = sql<{
        b: string
        c: boolean
      }>`'{"b": "world", "c": true}'::jsonb`

      const merged1 = jsonMerge(base1, overlay1)
      const result1 = await executeQuery(db, merged1)

      // Test array merging
      const base2 = sql<number[]>`'[1, 2, 3]'::jsonb`
      const overlay2 = sql<number[]>`'[4, 5]'::jsonb`

      const merged2 = jsonMerge(base2, overlay2)
      const result2 = await executeQuery(db, merged2)

      // Test merging array with scalar
      const base3 = sql<number[]>`'[1, 2]'::jsonb`
      const overlay3 = sql<number>`'3'::jsonb`

      const merged3 = jsonMerge(base3, overlay3)
      const result3 = await executeQuery(db, merged3)

      expect(result1).toEqual({ a: 1, b: 'world', c: true })
      expect(result2).toEqual([1, 2, 3, 4, 5])
      expect(result3).toEqual([1, 2, 3])
    })

    it('should test all array functions with type preservation', async () => {
      // Test with numbers
      const numbers = sql<number[]>`'[10, 20, 30]'::jsonb`
      const numbersWithNew = jsonArrayPush(numbers, 40, 50)
      const numbersUpdated = jsonArraySet(numbersWithNew, 1, 99)
      const numbersReduced = jsonArrayDelete(numbersUpdated, 0)

      const numberResult = await executeQuery(db, numbersReduced)
      expect(numberResult).toEqual([99, 30, 40, 50])

      // Test with booleans
      const bools = sql<boolean[]>`'[true, false]'::jsonb`
      const boolsWithNew = jsonArrayPush(bools, true)
      const boolsUpdated = jsonArraySet(boolsWithNew, 0, false)

      const boolResult = await executeQuery(db, boolsUpdated)
      expect(boolResult).toEqual([false, false, true])

      // Test with objects
      const objects = sql<
        { id: number; name: string }[]
      >`'[{"id": 1, "name": "first"}]'::jsonb`
      const objectsWithNew = jsonArrayPush(objects, { id: 2, name: 'second' })
      const objectsUpdated = jsonArraySet(objectsWithNew, 0, {
        id: 99,
        name: 'updated',
      })

      const objectResult = await executeQuery(db, objectsUpdated)
      expect(objectResult).toEqual([
        { id: 99, name: 'updated' },
        { id: 2, name: 'second' },
      ])
    })
  })
})
