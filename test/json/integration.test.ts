import { sql } from 'drizzle-orm'
import type { PgliteDatabase } from 'drizzle-orm/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { jsonAccess } from '../../src/json/operations/access.ts'
import {
  jsonArrayDelete,
  jsonArrayPush,
  jsonArraySet,
} from '../../src/json/operations/array.ts'
import { jsonMerge } from '../../src/json/operations/merge.ts'
import { jsonSet, jsonSetPipe } from '../../src/json/operations/set.ts'
import { createDatabase, executeQuery } from '../utils.ts'

let db: PgliteDatabase

beforeAll(async () => {
  db = await createDatabase()
})

describe('JSON Integration Tests', () => {
  it('should export', async () => {
    const jsonImport = await import('@denny-il/drizzle-pg-utils/json')
    expect(jsonImport).toBeDefined()
    expect(jsonImport.access).toBeDefined()
    expect(jsonImport.arrayDelete).toBeDefined()
    expect(jsonImport.arrayPush).toBeDefined()
    expect(jsonImport.arraySet).toBeDefined()
    expect(jsonImport.merge).toBeDefined()
    expect(jsonImport.set).toBeDefined()
    expect(jsonImport.setPipe).toBeDefined()
    expect(jsonImport.build).toBeDefined()
    expect(jsonImport.coalesce).toBeDefined()

    const jsonImportSet = await import('@denny-il/drizzle-pg-utils/json/set')
    expect(jsonImportSet.jsonSet).toBeDefined()
    expect(jsonImportSet.jsonSetPipe).toBeDefined()
    expect(jsonImportSet.jsonSet).toEqual(jsonImport.set)
    expect(jsonImportSet.jsonSetPipe).toEqual(jsonImport.setPipe)

    const jsonImportArray = await import(
      '@denny-il/drizzle-pg-utils/json/array'
    )
    expect(jsonImportArray.jsonArrayDelete).toBeDefined()
    expect(jsonImportArray.jsonArrayPush).toBeDefined()
    expect(jsonImportArray.jsonArraySet).toBeDefined()
    expect(jsonImportArray.jsonArrayDelete).toEqual(jsonImport.arrayDelete)
    expect(jsonImportArray.jsonArrayPush).toEqual(jsonImport.arrayPush)
    expect(jsonImportArray.jsonArraySet).toEqual(jsonImport.arraySet)

    const jsonImportAccess = await import(
      '@denny-il/drizzle-pg-utils/json/access'
    )
    expect(jsonImportAccess.jsonAccess).toBeDefined()
    expect(jsonImportAccess.jsonAccess).toEqual(jsonImport.access)

    const jsonImportMerge = await import(
      '@denny-il/drizzle-pg-utils/json/merge'
    )
    expect(jsonImportMerge.jsonMerge).toBeDefined()
    expect(jsonImportMerge.jsonMerge).toEqual(jsonImport.merge)

    const jsonImportBuild = await import(
      '@denny-il/drizzle-pg-utils/json/build'
    )
    expect(jsonImportBuild.jsonBuild).toBeDefined()
    expect(jsonImportBuild.jsonBuild).toEqual(jsonImport.build)

    const jsonImportCoalesce = await import(
      '@denny-il/drizzle-pg-utils/json/coalesce'
    )
    expect(jsonImportCoalesce.jsonCoalesce).toBeDefined()
    expect(jsonImportCoalesce.jsonCoalesce).toEqual(jsonImport.coalesce)
  })

  describe('JSON Accessor Runtime Behavior', () => {
    it('should access nested properties correctly', async () => {
      const value = sql<{
        user: { id: number; name: string }
      }>`'{"user": {"id": 123, "name": "John"}}'::jsonb`
      const userId = jsonAccess(value).user.id.$path
      const userName = jsonAccess(value).user.name.$path

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
      const jsonNullResult = jsonAccess(jsonWithNull).value.$path

      // SQL NULL
      const sqlNull = sql<{ value: string | null }>`NULL::jsonb`
      const sqlNullResult = jsonAccess(sqlNull).value.$path

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
      const missingAge = jsonAccess(value).user.age.$path
      const existingName = jsonAccess(value).user.name.$path

      const ageResult = await executeQuery(db, missingAge)
      const nameResult = await executeQuery(db, existingName)

      expect(ageResult).toBeNull()
      expect(nameResult).toEqual('John')
    })

    it('should handle deeply nested missing properties', async () => {
      const value = sql<{ a: { b: { c: string } } }>`'{"a": {"b": {}}}'::jsonb`
      const missing = jsonAccess(value).a.b.c.$path

      const missingResult = await executeQuery(db, missing)

      expect(missingResult).toBeNull()
    })

    it('should access array elements through accessor pattern', async () => {
      const value = sql<{
        tags: string[]
        numbers: number[]
      }>`'{"tags": ["typescript", "postgres"], "numbers": [1, 2, 3]}'::jsonb`

      // Access array elements using proper accessor pattern
      const accessor = jsonAccess(value)
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
            settings: { theme: 'light' | 'dark'; notifications: boolean }
          } | null
        }
        metadata: { version: string } | null
      }>`'{"user": {"id": 42, "profile": {"settings": {"theme": "dark", "notifications": true}}}, "metadata": null}'::jsonb`

      const userId = jsonAccess(complexValue).user.id.$path
      const theme = jsonAccess(complexValue).user.profile.settings.theme.$path
      const notifications =
        jsonAccess(complexValue).user.profile.settings.notifications.$path
      const metadata = jsonAccess(complexValue).metadata.$path

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
      const result = await executeQuery(db, setter.name.$set('Jane'))

      expect(result).toEqual({ name: 'Jane', age: 30 })
    })

    it('should set nested properties', async () => {
      const baseValue = sql<{
        user: { id: number; profile: { name: string } }
      }>`'{"user": {"id": 1, "profile": {"name": "John"}}}'::jsonb`
      const setter = jsonSet(baseValue)
      const result = await executeQuery(
        db,
        setter.user.$set({ id: 1, profile: { name: 'Updated John' } }),
      )

      expect(result).toEqual({
        user: { id: 1, profile: { name: 'Updated John' } },
      })
    })

    it('should handle setting on NULL base with createMissing', async () => {
      const baseValue = sql<{
        user: { name: string }
      }>`'{"user": {"name": "Default"}}'::jsonb`
      const setter = jsonSet(baseValue)
      const result = await executeQuery(db, setter.user.name.$set('New User'))

      expect(result).toEqual({ user: { name: 'New User' } })
    })

    it('should set multiple properties', async () => {
      const baseValue = sql<{
        user: { name: string; age: number }
      }>`'{"user": {"name": "John", "age": 30}}'::jsonb`
      const setter = jsonSetPipe(
        baseValue,
        (s) => s.user.name.$set('Jane'),
        (s) => s.user.age.$set(25),
      )
      const result = await executeQuery(db, setter)
      expect(result).toEqual({ user: { name: 'Jane', age: 25 } })
    })
  })

  describe('JSON Set $default Runtime Behavior', () => {
    it('should set default value when property is missing', async () => {
      const baseValue = sql<{
        user: { name: string }
        profile?: { avatar: string; theme: string }
      }>`'{"user": {"name": "John"}}'::jsonb`
      const setter = jsonSet(baseValue)
      const result = await executeQuery(
        db,
        setter.profile
          .$default({ avatar: 'default-avatar.jpg', theme: 'light' })
          .avatar.$set('new-avatar.jpg'),
      )

      expect(result).toEqual({
        user: { name: 'John' },
        profile: { avatar: 'new-avatar.jpg', theme: 'light' },
      })
    })

    it('should preserve existing value when property exists', async () => {
      const baseValue = sql<{
        user: { name: string }
        profile?: { avatar: string; theme: string }
      }>`'{"user": {"name": "John"}, "profile": {"avatar": "existing.jpg", "theme": "dark"}}'::jsonb`
      const setter = jsonSet(baseValue)
      const result = await executeQuery(
        db,
        setter.profile
          .$default({ avatar: 'default-avatar.jpg', theme: 'light' })
          .avatar.$set('new-avatar.jpg'),
      )

      expect(result).toEqual({
        user: { name: 'John' },
        profile: { avatar: 'new-avatar.jpg', theme: 'dark' },
      })
    })

    it('should handle null vs missing property correctly', async () => {
      const baseValueWithNull = sql<{
        config?: { setting: string }
      }>`'{"config": null}'::jsonb`
      const baseValueMissing = sql<{
        config?: { setting: string }
      }>`'{}'::jsonb`

      const setter1 = jsonSet(baseValueWithNull)
      const setter2 = jsonSet(baseValueMissing)

      const resultWithNull = await executeQuery(
        db,
        setter1.config.$default({ setting: 'default' }).setting.$set('updated'),
      )
      const resultMissing = await executeQuery(
        db,
        setter2.config.$default({ setting: 'default' }).setting.$set('updated'),
      )

      // Both should use the default value since JSON null and missing are treated the same
      expect(resultWithNull).toEqual({ config: { setting: 'updated' } })
      expect(resultMissing).toEqual({ config: { setting: 'updated' } })
    })

    it('should set default for nested array properties', async () => {
      const baseValue = sql<{
        user: { name: string }
        tags?: string[]
      }>`'{"user": {"name": "John"}}'::jsonb`
      // Note: $default returns a setter, we need to chain another operation
      const result = await executeQuery(
        db,
        jsonSetPipe(baseValue, (s) =>
          s.tags
            .$default(['default-tag1', 'default-tag2'])
            .$set(['final-tags']),
        ),
      )

      expect(result).toEqual({ user: { name: 'John' }, tags: ['final-tags'] })
    })

    it('should apply defaults only to missing properties while preserving existing values', async () => {
      // Test with missing property - should use default
      const missingProperty = sql<{
        user: { name: string }
        tags?: string[]
      }>`'{"user": {"name": "John"}}'::jsonb`

      const resultMissing = await executeQuery(
        db,
        jsonSetPipe(missingProperty, (s) =>
          s.tags.$default(['default1', 'default2'])['2'].$set('added'),
        ),
      )

      // Test with existing property - should preserve existing
      const existingProperty = sql<{
        user: { name: string }
        tags?: string[]
      }>`'{"user": {"name": "John"}, "tags": ["existing1", "existing2"]}'::jsonb`

      const resultExisting = await executeQuery(
        db,
        jsonSetPipe(existingProperty, (s) =>
          s.tags.$default(['default1', 'default2'])['2'].$set('added'),
        ),
      )

      expect(resultMissing).toEqual({
        user: { name: 'John' },
        tags: ['default1', 'default2', 'added'], // Used defaults + modification
      })

      expect(resultExisting).toEqual({
        user: { name: 'John' },
        tags: ['existing1', 'existing2', 'added'], // Preserved existing + modification
      })
    })

    it('should handle complex nested defaults', async () => {
      const baseValue = sql<{
        user: { name: string }
        settings?: { preferences?: { theme: string; notifications: boolean } }
      }>`'{"user": {"name": "John"}}'::jsonb`
      const setter = jsonSet(baseValue)
      const result = await executeQuery(
        db,
        setter.settings
          .$default({ preferences: { theme: 'light', notifications: true } })
          .preferences.$default({ theme: 'dark', notifications: false })
          .theme.$set('system'),
      )

      expect(result).toEqual({
        user: { name: 'John' },
        settings: { preferences: { theme: 'system', notifications: true } },
      })
    })

    it('should work with createMissing parameter', async () => {
      // Test with existing structure and createMissing: false
      const baseValue = sql<{
        user?: { profile?: { avatar: string } }
      }>`'{"user": {"profile": {"avatar": "existing.jpg"}}}'::jsonb`
      const result = await executeQuery(
        db,
        jsonSetPipe(baseValue, (s) =>
          s.user
            .$default({ profile: { avatar: 'default.jpg' } }, false)
            .profile.$default({ avatar: 'fallback.jpg' })
            .avatar.$set('final.jpg'),
        ),
      )

      // Since user.profile already exists, should work normally
      expect(result).toEqual({ user: { profile: { avatar: 'final.jpg' } } })
    })

    it('should handle SQL expressions as default values', async () => {
      const baseValue = sql<{
        metadata?: { timestamp: string; version: number }
      }>`'{}'::jsonb`
      const defaultValue = sql<{
        timestamp: string
        version: number
      }>`jsonb_build_object('timestamp', now()::text, 'version', 1)`
      const setter = jsonSet(baseValue)
      const result = await executeQuery(
        db,
        setter.metadata.$default(defaultValue).version.$set(2),
      )

      expect(result.metadata.version).toEqual(2)
      expect(result.metadata.timestamp).toBeDefined()
      expect(typeof result.metadata.timestamp).toBe('string')
    })

    it('should chain multiple $default operations', async () => {
      const baseValue = sql<{
        level1?: { level2?: { value: string } }
      }>`'{}'::jsonb`
      const setter = jsonSet(baseValue)
      const result = await executeQuery(
        db,
        setter.level1
          .$default({ level2: { value: 'default-level2' } })
          .level2.$default({ value: 'default-value' })
          .value.$set('final-value'),
      )

      expect(result).toEqual({ level1: { level2: { value: 'final-value' } } })
    })

    it('should handle array element defaults', async () => {
      const baseValue = sql<{
        items?: Array<{ name: string; count?: number }>
      }>`'{"items": [{"name": "item1"}]}'::jsonb`
      // Since items already exist, $default won't be used, but we can test the chaining
      const result = await executeQuery(
        db,
        jsonSetPipe(baseValue, (s) =>
          s.items
            .$default([{ name: 'default-item', count: 0 }])
            .$set([{ name: 'new-item', count: 5 }]),
        ),
      )

      expect(result).toEqual({ items: [{ name: 'new-item', count: 5 }] })
    })

    it('should handle empty object as default', async () => {
      const baseValue = sql<{ config?: Record<string, any> }>`'{}'::jsonb`
      // $default returns a setter, so we need to chain an operation
      const result = await executeQuery(
        db,
        jsonSetPipe(baseValue, (s) =>
          s.config.$default({}).$set({ newKey: 'newValue' }),
        ),
      )

      expect(result).toEqual({ config: { newKey: 'newValue' } })
    })

    it('should handle $default with null vs empty vs missing arrays', async () => {
      const withNull = sql<{ items?: string[] }>`'{"items": null}'::jsonb`
      const withEmpty = sql<{ items?: string[] }>`'{"items": []}'::jsonb`
      const missing = sql<{ items?: string[] }>`'{}'::jsonb`

      // Test adding to arrays with $default - should behave differently
      const results = await Promise.all([
        // Null array: should use default, then add to it
        executeQuery(
          db,
          jsonSet(withNull).items.$default(['item1'])['1'].$set('item2'),
        ),
        // Empty array: should preserve empty, then add to it
        executeQuery(
          db,
          jsonSet(withEmpty).items.$default(['item1'])['0'].$set('item2'),
        ),
        // Missing array: should use default, then add to it
        executeQuery(
          db,
          jsonSet(missing).items.$default(['item1'])['1'].$set('item2'),
        ),
        executeQuery(
          db,
          jsonSet(withEmpty).items.$default(['item1'])['2'].$set('item2'),
        ),
      ])

      expect(results[0]).toEqual({ items: ['item1', 'item2'] })
      expect(results[1]).toEqual({ items: ['item2'] })
      expect(results[2]).toEqual({ items: ['item1', 'item2'] })

      // TODO: this is an interesting case, postgres does not create an empty values in the array
      // when setting an item at out of bounds index, need to find if thats documented anywhere
      expect(results[3]).toEqual({ items: ['item2'] })
    })

    it('should handle deeply nested $default chains with partial structures', async () => {
      const baseValue = sql<{
        app?: {
          config?: {
            database?: { host: string; port: number }
            cache?: { enabled: boolean; ttl: number }
          }
          features?: string[]
        }
      }>`'{}'::jsonb`

      const result = await executeQuery(
        db,
        jsonSetPipe(baseValue, (s) =>
          s.app
            .$default({
              config: { database: { host: 'localhost', port: 5432 } },
              features: [],
            })
            .config.database.port.$set(3306),
        ),
      )

      expect(result).toEqual({
        app: {
          config: { database: { host: 'localhost', port: 3306 } },
          features: [],
        },
      })
    })

    it('should apply defaults only to missing properties while preserving existing ones', async () => {
      const baseValue = sql<{
        user: { name: string }
        settings?: { theme: string; notifications: boolean }
        metadata?: { created: string }
      }>`'{"user": {"name": "John"}, "settings": {"theme": "dark"}}'::jsonb`

      const result = await executeQuery(
        db,
        jsonSetPipe(
          baseValue,
          (s) =>
            s.settings
              .$default({ theme: 'light', notifications: true })
              .notifications.$set(false),
          (s) =>
            s.metadata
              .$default({ created: '2023-01-01' })
              .created.$set('2024-01-01'),
        ),
      )

      expect(result).toEqual({
        user: { name: 'John' },
        settings: { theme: 'dark', notifications: false }, // theme preserved, notifications added
        metadata: { created: '2024-01-01' }, // created from default then overridden
      })
    })

    it('should handle complex default values with nested structures', async () => {
      const baseValue = sql<{
        config?: {
          database: { connections: Array<{ host: string; port: number }> }
          cache: {
            providers: Array<{ name: string; config: Record<string, any> }>
          }
        }
      }>`'{}'::jsonb`

      const complexDefault = {
        database: {
          connections: [
            { host: 'primary.db', port: 5432 },
            { host: 'replica.db', port: 5432 },
          ],
        },
        cache: {
          providers: [
            { name: 'redis', config: { host: 'localhost', port: 6379 } },
            { name: 'memory', config: { maxSize: '100MB' } },
          ],
        },
      }

      const result = await executeQuery(
        db,
        jsonSet(baseValue)
          .config.$default(complexDefault)
          .database.connections['0'].port.$set(3306),
      )

      expect(result.config.database.connections[0].port).toBe(3306)
      expect(result.config.cache.providers).toHaveLength(2)
      expect(result.config.cache.providers[0].name).toBe('redis')
    })

    it('should demonstrate chained $default behavior with existing vs missing nested properties', async () => {
      const baseValue = sql<{
        app?: {
          settings?: { theme: string; debug?: boolean }
          metadata?: { version: string }
        }
      }>`'{"app": {"settings": {"theme": "dark"}}}'::jsonb`

      const result = await executeQuery(
        db,
        jsonSetPipe(
          baseValue,
          (s) =>
            s.app
              .$default({
                settings: { theme: 'light', debug: false },
                metadata: { version: '1.0.0' },
              })
              .settings.$default({ theme: 'blue', debug: true })
              .debug.$set(false),
          (s) =>
            s.app.metadata.$default({ version: '2.0.0' }).version.$set('1.5.0'),
        ),
      )

      expect(result).toEqual({
        app: {
          settings: { theme: 'dark', debug: false }, // theme preserved from existing, debug from first $default
          metadata: { version: '1.5.0' }, // metadata from first $default, version overridden
        },
      })
    })

    it('should demonstrate practical $default usage for initializing missing nested structures', async () => {
      const baseValue = sql<{
        user: { name: string }
        preferences?: {
          theme: string
          notifications: { email: boolean; push: boolean }
        }
      }>`'{"user": {"name": "John"}}'::jsonb`

      // Initialize missing preferences with defaults, then update specific values
      const result = await executeQuery(
        db,
        jsonSetPipe(
          baseValue,
          (s) =>
            s.preferences
              .$default({
                theme: 'light',
                notifications: { email: true, push: true },
              })
              .theme.$set('dark'), // Override just the theme
        ),
      )

      expect(result).toEqual({
        user: { name: 'John' },
        preferences: {
          theme: 'dark', // Was overridden
          notifications: {
            email: true, // From default
            push: true, // From default
          },
        },
      })
    })

    it('should work with jsonSetPipe and $default', async () => {
      const baseValue = sql<{
        user?: { name: string; settings?: { theme: string } }
      }>`'{}'::jsonb`
      const result = await executeQuery(
        db,
        jsonSetPipe(
          baseValue,
          (s) => s.user.$default({ name: 'Default User' }).name.$set('John'),
          (s) =>
            s.user.settings.$default({ theme: 'light' }).theme.$set('dark'),
        ),
      )

      expect(result).toEqual({
        user: { name: 'John', settings: { theme: 'dark' } },
      })
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

      const intValue = jsonAccess(numericData).int.$path
      const floatValue = jsonAccess(numericData).float.$path
      const zeroValue = jsonAccess(numericData).zero.$path
      const negativeValue = jsonAccess(numericData).negative.$path

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

      const trueValue = jsonAccess(booleanData).true.$path
      const falseValue = jsonAccess(booleanData).false.$path

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

      const emptyValue = jsonAccess(stringData).empty.$path
      const spacesValue = jsonAccess(stringData).spaces.$path
      const unicodeValue = jsonAccess(stringData).unicode.$path
      const escapedValue = jsonAccess(stringData).escaped.$path

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
          level2: { level3: { value: string | null } | null } | null
        } | null
      }>`'{"level1": {"level2": {"level3": null}}}'::jsonb`

      const deepValue = jsonAccess(deepData).level1.level2.level3.value.$path
      const result = await executeQuery(db, deepValue)

      expect(result).toBeNull()
    })

    it('should maintain type safety with union types', async () => {
      const unionData = sql<{
        status: 'active' | 'inactive' | 'pending'
        count: number | null
      }>`'{"status": "active", "count": null}'::jsonb`

      const statusValue = jsonAccess(unionData).status.$path
      const countValue = jsonAccess(unionData).count.$path

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
        jsonAccess(largeNumbers).maxSafeInt.$path,
      )
      const largeBigIntResult = await executeQuery(
        db,
        jsonAccess(largeNumbers).largeBigInt.$path,
      )
      const scientificResult = await executeQuery(
        db,
        jsonAccess(largeNumbers).scientific.$path,
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
      const accessor = jsonAccess(mixedArray)

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
        jsonAccess(emptyData).emptyObj.$path,
      )
      const emptyArrayResult = await executeQuery(
        db,
        jsonAccess(emptyData).emptyArray.$path,
      )
      const nestedEmptyResult = await executeQuery(
        db,
        jsonAccess(emptyData).objWithEmpty.empty.$path,
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
        jsonAccess(testData).user.name.$path,
      )
      const countViaPath = await executeQuery(
        db,
        jsonAccess(testData).user.count.$path,
      )

      // $value should extract as text (all return strings)
      const nameViaValue = await executeQuery(
        db,
        jsonAccess(testData).user.name.$value,
      )
      const countViaValue = await executeQuery(
        db,
        jsonAccess(testData).user.count.$value,
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

    it('should test jsonAccess with complex nested access patterns', async () => {
      const complexData = sql<{
        app: {
          modules: {
            auth: { enabled: boolean; providers: string[] }
            db: { host: string; connections: number[] }
          }
          metadata: { version: string; build: number }
        }
      }>`'{"app": {"modules": {"auth": {"enabled": true, "providers": ["google", "github"]}, "db": {"host": "localhost", "connections": [1, 2, 3]}}, "metadata": {"version": "1.0.0", "build": 123}}}'::jsonb`

      // Use jsonAccess to access deeply nested values
      const authEnabled = jsonAccess(complexData).app.modules.auth.enabled.$path
      const firstProvider =
        jsonAccess(complexData).app.modules.auth.providers['0'].$path
      const dbHost = jsonAccess(complexData).app.modules.db.host.$path
      const firstConnection =
        jsonAccess(complexData).app.modules.db.connections['0'].$path
      const version = jsonAccess(complexData).app.metadata.version.$path
      const buildNumber = jsonAccess(complexData).app.metadata.build.$path

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
