import { type SQL, sql } from 'drizzle-orm'

import { describe, expect, expectTypeOf, it } from 'vitest'
import { jsonAccessor, type SQLJSONAccess } from '../../src/json/access.ts'
import { dialect } from '../utils.ts'

describe('JSON Accessor', () => {
  type JsonType = {
    user: {
      id: number
      name: string
      profile: {
        avatar: string
        preferences: {
          theme: 'light' | 'dark'
          notifications: boolean
        }
      }
    }
    tags: string[]
    metadata: Record<string, any>
  }

  const jsonObjectSql = `'{"user": {"id": 1, "name": "John", "profile": {"avatar": "url", "preferences": {"theme": "dark", "notifications": true}}}, "tags": ["tag1", "tag2"], "metadata": {"key": "value"}}'::jsonb`
  const jsonObject = sql<JsonType>`${sql.raw(jsonObjectSql)}`

  describe('Basic Property Access', () => {
    it('creates accessor for simple property', () => {
      const accessor = jsonAccessor(jsonObject)
      expect(accessor).toBeDefined()
      expect(typeof accessor).toBe('object')
    })

    it('generates correct SQL for root access', () => {
      const accessor = jsonAccessor(jsonObject)
      const query = dialect.sqlToQuery(accessor.$path)

      // Root access should just return the source directly
      expect(query.params).toEqual([])
      expect(query.sql).toBe(jsonObjectSql)
    })

    it('generates correct SQL for property access', () => {
      const accessor = jsonAccessor(jsonObject)
      const userAccess = accessor.user.$path
      const query = dialect.sqlToQuery(userAccess)

      expect(query.params).toEqual([])
      expect(query.sql).toBe(`jsonb_extract_path(${jsonObjectSql}, 'user')`)
    })

    it('supports the $$ syntax for path extraction', () => {
      const accessor = jsonAccessor(jsonObject)
      const pathSQL = accessor.$path
      const query = dialect.sqlToQuery(pathSQL)

      expect(query.params).toEqual([])
      expect(query.sql).toBe(jsonObjectSql)
    })
  })

  describe('Nested Property Access', () => {
    it('accesses nested object properties', () => {
      const accessor = jsonAccessor(jsonObject)
      const nameAccess = accessor.user.name.$path
      const query = dialect.sqlToQuery(nameAccess)

      expect(query.params).toEqual([])
      expect(query.sql).toBe(
        `jsonb_extract_path(${jsonObjectSql}, 'user','name')`,
      )
    })

    it('accesses deeply nested properties', () => {
      const accessor = jsonAccessor(jsonObject)
      const themeAccess = accessor.user.profile.preferences.theme.$path
      const query = dialect.sqlToQuery(themeAccess)

      expect(query.params).toEqual([])
      expect(query.sql).toBe(
        `jsonb_extract_path(${jsonObjectSql}, 'user','profile','preferences','theme')`,
      )
    })

    it('handles array access', () => {
      const accessor = jsonAccessor(jsonObject)
      const tagsAccess = accessor.tags.$path
      const query = dialect.sqlToQuery(tagsAccess)

      expect(query.params).toEqual([])
      expect(query.sql).toBe(`jsonb_extract_path(${jsonObjectSql}, 'tags')`)
    })
  })

  describe('Type Safety', () => {
    it('has correct types for accessor', () => {
      const accessor = jsonAccessor(jsonObject)

      // Test with SQLJSONAccessor type
      expectTypeOf(accessor).toEqualTypeOf<SQLJSONAccess<SQL<JsonType>>>()
    })

    it('preserves type information through chaining', () => {
      const accessor = jsonAccessor(jsonObject)

      // Test nested property access types
      expectTypeOf(accessor.user).toEqualTypeOf<
        SQLJSONAccess<SQL<JsonType['user']>>
      >()

      expectTypeOf(accessor.user.name).toEqualTypeOf<
        SQLJSONAccess<SQL<JsonType['user']['name']>>
      >()

      expectTypeOf(accessor.tags).toEqualTypeOf<
        SQLJSONAccess<SQL<JsonType['tags']>>
      >()
    })

    it('handles deeply nested property types', () => {
      const accessor = jsonAccessor(jsonObject)

      expectTypeOf(accessor.user.profile).toEqualTypeOf<
        SQLJSONAccess<SQL<JsonType['user']['profile']>>
      >()

      expectTypeOf(accessor.user.profile.preferences).toEqualTypeOf<
        SQLJSONAccess<SQL<JsonType['user']['profile']['preferences']>>
      >()

      expectTypeOf(accessor.user.profile.preferences.theme).toEqualTypeOf<
        SQLJSONAccess<SQL<JsonType['user']['profile']['preferences']['theme']>>
      >()

      expectTypeOf(accessor.metadata).toEqualTypeOf<
        SQLJSONAccess<SQL<JsonType['metadata']>>
      >()
    })
  })

  describe('Edge Cases', () => {
    it('handles nullable JSON values', () => {
      type JsonType = { prop?: string | null }
      const nullableJson = sql<JsonType>`'{"prop": null}'::jsonb`
      const accessor = jsonAccessor(nullableJson)
      const propAccess = accessor.prop
      const query = dialect.sqlToQuery(propAccess.$path)

      expect(query.params).toEqual([])
      expect(query.sql).toBe(
        `jsonb_extract_path('{"prop": null}'::jsonb, 'prop')`,
      )
      expectTypeOf(propAccess).toEqualTypeOf<
        SQLJSONAccess<SQL<JsonType['prop'] | null>>
      >()
    })

    it('works with empty object', () => {
      type JsonType = {}
      const emptyJson = sql<JsonType>`'{}'::jsonb`
      const accessor = jsonAccessor(emptyJson)
      const query = dialect.sqlToQuery(accessor.$path)

      expect(query.params).toEqual([])
      expect(query.sql).toBe(`'{}'::jsonb`)
      expectTypeOf(accessor).toEqualTypeOf<SQLJSONAccess<SQL<JsonType>>>()
    })

    it('handles dynamic property names', () => {
      const accessor = jsonAccessor(jsonObject)
      const metadataAccess = accessor.metadata
      const query = dialect.sqlToQuery(metadataAccess.$path)

      expect(query.params).toEqual([])
      expect(query.sql).toBe(`jsonb_extract_path(${jsonObjectSql}, 'metadata')`)

      expectTypeOf(metadataAccess).toEqualTypeOf<
        SQLJSONAccess<SQL<JsonType['metadata']>>
      >()
    })
  })

  describe('SQL Generation', () => {
    it('generates inline parameters correctly', () => {
      const accessor = jsonAccessor(jsonObject)
      const nestedAccess = accessor.user.profile.avatar
      const query = dialect.sqlToQuery(nestedAccess.$path)

      expect(query.params).toEqual([])
      expect(query.sql).toBe(
        `jsonb_extract_path(${jsonObjectSql}, 'user','profile','avatar')`,
      )

      expectTypeOf(nestedAccess).toEqualTypeOf<SQLJSONAccess<SQL<string>>>()
    })

    it('builds correct path arrays', () => {
      const accessor = jsonAccessor(jsonObject)
      const deepAccess = accessor.user.profile.preferences
      const query = dialect.sqlToQuery(deepAccess.$path)

      expect(query.params).toEqual([])
      expect(query.sql).toBe(
        `jsonb_extract_path(${jsonObjectSql}, 'user','profile','preferences')`,
      )

      expectTypeOf(deepAccess).toEqualTypeOf<
        SQLJSONAccess<SQL<JsonType['user']['profile']['preferences']>>
      >()
    })

    it('generates correct SQL for $value access', () => {
      const accessor = jsonAccessor(jsonObject)
      const nameValue = accessor.user.name.$value
      const query = dialect.sqlToQuery(nameValue)

      expect(query.params).toEqual([])
      expect(query.sql).toBe(
        `jsonb_extract_path_text(${jsonObjectSql}, 'user','name')`,
      )
    })

    it('handles $value for nested properties', () => {
      const accessor = jsonAccessor(jsonObject)
      const themeValue = accessor.user.profile.preferences.theme.$value
      const query = dialect.sqlToQuery(themeValue)

      expect(query.params).toEqual([])
      expect(query.sql).toBe(
        `jsonb_extract_path_text(${jsonObjectSql}, 'user','profile','preferences','theme')`,
      )
    })
  })
})
