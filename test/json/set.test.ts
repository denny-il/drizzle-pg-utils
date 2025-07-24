import { type SQL, sql } from 'drizzle-orm'

import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  jsonSet,
  type SQLJSONSet,
  type SQLJSONSetFn,
} from '../../src/json/set.ts'
import { dialect } from '../utils.ts'

describe('JSON Set', () => {
  type JsonType = {
    id: number
    name: string
    profile: {
      avatar: string
      settings: {
        theme: 'light' | 'dark'
        notifications: boolean
      }
    }
    tags: string[]
    metadata: Record<string, any>
  }

  const jsonObjectSql = `'{"id": 1, "name": "John", "profile": {"avatar": "url", "settings": {"theme": "dark", "notifications": true}}, "tags": ["tag1"], "metadata": {}}'::jsonb`

  const jsonObject = sql<JsonType>`${sql.raw(jsonObjectSql)}`

  describe('Basic Property Setting', () => {
    it('creates a setter function', () => {
      const setter = jsonSet(jsonObject)
      expect(typeof setter).toBe('object')
    })

    it('sets a complete object value', () => {
      const setter = jsonSet(jsonObject)
      const newValue = {
        id: 2,
        name: 'Jane',
        profile: {
          avatar: 'new-url',
          settings: {
            theme: 'light' as const,
            notifications: false,
          },
        },
        tags: ['tag2'],
        metadata: { key: 'value' },
      }

      const result = setter.$set(newValue)
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual(
        [2, 'Jane', 'new-url', 'light', false, 'tag2', 'value'].map((v) =>
          JSON.stringify(v),
        ),
      )
      expect(query.sql).toBe(
        `jsonb_build_object('id', $1::jsonb,'name', $2::jsonb,'profile', jsonb_build_object('avatar', $3::jsonb,'settings', jsonb_build_object('theme', $4::jsonb,'notifications', $5::jsonb)),'tags', jsonb_build_array($6::jsonb),'metadata', jsonb_build_object('key', $7::jsonb))`,
      )
    })

    it('sets with createMissing parameter', () => {
      const setter = jsonSet(jsonObject)
      const newValue = {
        id: 2,
        name: 'Jane',
        profile: {
          avatar: 'new-url',
          settings: {
            theme: 'light' as const,
            notifications: false,
          },
        },
        tags: ['tag2'],
        metadata: { key: 'value' },
      }

      const result = setter.$set(newValue, false)
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual(
        [2, 'Jane', 'new-url', 'light', false, 'tag2', 'value'].map((v) =>
          JSON.stringify(v),
        ),
      )
      expect(query.sql).toBe(
        `jsonb_build_object('id', $1::jsonb,'name', $2::jsonb,'profile', jsonb_build_object('avatar', $3::jsonb,'settings', jsonb_build_object('theme', $4::jsonb,'notifications', $5::jsonb)),'tags', jsonb_build_array($6::jsonb),'metadata', jsonb_build_object('key', $7::jsonb))`,
      )
    })
  })

  describe('Nested Property Setting', () => {
    it('sets nested object property', () => {
      const setter = jsonSet(jsonObject)
      const result = setter.profile.$set({
        avatar: 'updated-url',
        settings: {
          theme: 'light',
          notifications: false,
        },
      })
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual(
        ['updated-url', 'light', false].map((v) => JSON.stringify(v)),
      )
      expect(query.sql).toBe(
        `jsonb_set(${jsonObjectSql}, array['profile']::text[], jsonb_build_object('avatar', $1::jsonb,'settings', jsonb_build_object('theme', $2::jsonb,'notifications', $3::jsonb)), true)`,
      )
    })

    it('sets deeply nested property', () => {
      const setter = jsonSet(jsonObject)
      const result = setter.profile.settings.$set({
        theme: 'light',
        notifications: false,
      })
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual(
        ['light', false].map((v) => JSON.stringify(v)),
      )
      expect(query.sql).toBe(
        `jsonb_set(${jsonObjectSql}, array['profile','settings']::text[], jsonb_build_object('theme', $1::jsonb,'notifications', $2::jsonb), true)`,
      )
    })

    it('sets simple nested property', () => {
      const setter = jsonSet(jsonObject)
      const result = setter.name.$set('Updated Name')
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual(
        ['Updated Name'].map((v) => JSON.stringify(v)),
      )
      expect(query.sql).toBe(
        `jsonb_set(${jsonObjectSql}, array['name']::text[], $1::jsonb, true)`,
      )
    })
  })

  describe('Array Value Handling', () => {
    it('sets array with primitive values', () => {
      const setter = jsonSet(jsonObject)
      const result = setter.tags.$set(['new-tag1', 'new-tag2', 'new-tag3'])
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual(
        ['new-tag1', 'new-tag2', 'new-tag3'].map((v) => JSON.stringify(v)),
      )
      expect(query.sql).toBe(
        `jsonb_set(${jsonObjectSql}, array['tags']::text[], jsonb_build_array($1::jsonb,$2::jsonb,$3::jsonb), true)`,
      )
    })

    it('sets array with mixed JS and SQL values', () => {
      const setter = jsonSet(jsonObject)
      const sqlValue = sql<string>`'sql-generated-tag'::text`
      const result = setter.tags.$set(['js-tag', sqlValue, 'another-js-tag'])
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual(
        ['js-tag', 'another-js-tag'].map((v) => JSON.stringify(v)),
      )
      expect(query.sql).toBe(
        `jsonb_set(${jsonObjectSql}, array['tags']::text[], jsonb_build_array($1::jsonb,'sql-generated-tag'::text,$2::jsonb), true)`,
      )
    })

    it('sets empty array', () => {
      const setter = jsonSet(jsonObject)
      const result = setter.tags.$set([])
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual([].map((v) => JSON.stringify(v)))
      expect(query.sql).toBe(
        `jsonb_set(${jsonObjectSql}, array['tags']::text[], jsonb_build_array(), true)`,
      )
    })
  })

  describe('Object Value Handling', () => {
    it('sets object with primitive values', () => {
      const setter = jsonSet(jsonObject)
      const result = setter.metadata.$set({
        stringKey: 'value',
        numberKey: 42,
        booleanKey: true,
      })
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual(
        ['value', 42, true].map((v) => JSON.stringify(v)),
      )
      expect(query.sql).toBe(
        `jsonb_set(${jsonObjectSql}, array['metadata']::text[], jsonb_build_object('stringKey', $1::jsonb,'numberKey', $2::jsonb,'booleanKey', $3::jsonb), true)`,
      )
    })

    it('sets object with mixed JS and SQL values', () => {
      const setter = jsonSet(jsonObject)
      const sqlValue = sql<number>`42::integer`
      const result = setter.metadata.$set({
        jsKey: 'js-value',
        sqlKey: sqlValue,
      })
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual(['js-value'].map((v) => JSON.stringify(v)))
      expect(query.sql).toBe(
        `jsonb_set(${jsonObjectSql}, array['metadata']::text[], jsonb_build_object('jsKey', $1::jsonb,'sqlKey', 42::integer), true)`,
      )
    })

    it('sets nested object structures', () => {
      const setter = jsonSet(jsonObject)
      const result = setter.metadata.$set({
        nested: {
          level1: {
            level2: 'deep-value',
          },
        },
      })
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual(['deep-value'].map((v) => JSON.stringify(v)))
      expect(query.sql).toBe(
        `jsonb_set(${jsonObjectSql}, array['metadata']::text[], jsonb_build_object('nested', jsonb_build_object('level1', jsonb_build_object('level2', $1::jsonb))), true)`,
      )
    })
  })

  describe('SQL Expression Handling', () => {
    it('passes through SQL expressions directly', () => {
      const setter = jsonSet(jsonObject)
      const sqlExpr = sql<string>`'direct-sql-value'::text`
      const result = setter.name.$set(sqlExpr)
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual([].map((v) => JSON.stringify(v)))
      expect(query.sql).toBe(
        `jsonb_set(${jsonObjectSql}, array['name']::text[], 'direct-sql-value'::text, true)`,
      )
    })

    it('handles complex SQL expressions in objects', () => {
      const setter = jsonSet(jsonObject)
      const complexSQL = sql`jsonb_build_object('computed', now()::text)`
      const result = setter.metadata.$set(complexSQL)
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual([].map((v) => JSON.stringify(v)))
      expect(query.sql).toBe(
        `jsonb_set(${jsonObjectSql}, array['metadata']::text[], jsonb_build_object('computed', now()::text), true)`,
      )
    })
  })

  describe('Type Safety', () => {
    it('has correct return type for setter function', () => {
      const setter = jsonSet(jsonObject)
      const result = setter.$set({
        id: 1,
        name: 'test',
        profile: {
          avatar: 'url',
          settings: {
            theme: 'dark',
            notifications: true,
          },
        },
        tags: [],
        metadata: {},
      })

      expectTypeOf(result).toEqualTypeOf<SQL<JsonType>>()
    })

    it('has correct return type for nested setters', () => {
      const setter = jsonSet(jsonObject)

      const nameResult = setter.name.$set('New Name')
      const profileResult = setter.profile.$set({
        avatar: 'new-avatar',
        settings: { theme: 'light', notifications: false },
      })

      expectTypeOf(nameResult).toEqualTypeOf<SQL<JsonType>>()
      expectTypeOf(profileResult).toEqualTypeOf<SQL<JsonType>>()
    })

    it('supports deep property access through types', () => {
      const setter = jsonSet(jsonObject)

      const avatarResult = setter.profile.avatar.$set('new-avatar.jpg')
      const themeResult = setter.profile.settings.theme.$set('light')

      expectTypeOf(avatarResult).toEqualTypeOf<SQL<JsonType>>()
      expectTypeOf(themeResult).toEqualTypeOf<SQL<JsonType>>()
    })

    it('verifies setter function types', () => {
      const setter = jsonSet(jsonObject)

      // Test that setter functions exist and have callable types
      expectTypeOf(setter.name).toEqualTypeOf<{
        $set: SQLJSONSetFn<string, SQL<JsonType>>
      }>()
      expectTypeOf(setter.profile).toEqualTypeOf<
        SQLJSONSet<SQL<JsonType>, SQL<JsonType['profile']>>
      >()
      expectTypeOf(setter.tags).toEqualTypeOf<
        SQLJSONSet<SQL<JsonType>, SQL<JsonType['tags']>>
      >()
      expectTypeOf(setter.metadata).toEqualTypeOf<
        SQLJSONSet<SQL<JsonType>, SQL<JsonType['metadata']>>
      >()
    })
  })

  describe('Edge Cases', () => {
    it('handles null values in objects', () => {
      const setter = jsonSet(jsonObject)
      const result = setter.metadata.$set({ nullKey: null })
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual([null].map((v) => JSON.stringify(v)))
      expect(query.sql).toBe(
        `jsonb_set(${jsonObjectSql}, array['metadata']::text[], jsonb_build_object('nullKey', $1::jsonb), true)`,
      )
    })

    it('handles undefined values gracefully', () => {
      const setter = jsonSet(jsonObject)
      const result = setter.metadata.$set({ undefinedKey: undefined })
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual([].map((v) => JSON.stringify(v)))
      expect(query.sql).toBe(
        `jsonb_set(${jsonObjectSql}, array['metadata']::text[], jsonb_build_object(), true)`,
      )
    })

    it('handles empty objects', () => {
      const setter = jsonSet(jsonObject)
      const result = setter.metadata.$set({})
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual([].map((v) => JSON.stringify(v)))
      expect(query.sql).toBe(
        `jsonb_set(${jsonObjectSql}, array['metadata']::text[], jsonb_build_object(), true)`,
      )
    })

    it('works with simple JSON types', () => {
      const simpleJson = sql<{ value: string }>`'{"value": "test"}'::jsonb`
      const setter = jsonSet(simpleJson)
      const result = setter.value.$set('updated')
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual(['updated'].map((v) => JSON.stringify(v)))
      expect(query.sql).toBe(
        `jsonb_set('{"value": "test"}'::jsonb, array['value']::text[], $1::jsonb, true)`,
      )
    })
  })

  describe('Path Array Generation', () => {
    it('generates correct path arrays for nested access', () => {
      const setter = jsonSet(jsonObject)
      const result = setter.profile.settings.theme.$set('light')
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual(['light'].map((v) => JSON.stringify(v)))
      expect(query.sql).toBe(
        `jsonb_set(${jsonObjectSql}, array['profile','settings','theme']::text[], $1::jsonb, true)`,
      )
    })

    it('handles single-level paths', () => {
      const setter = jsonSet(jsonObject)
      const result = setter.id.$set(999)
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual([999].map((v) => JSON.stringify(v)))
      expect(query.sql).toBe(
        `jsonb_set(${jsonObjectSql}, array['id']::text[], $1::jsonb, true)`,
      )
    })
  })

  describe('Complex Scenarios', () => {
    it('chains multiple setter operations', () => {
      const setter = jsonSet(jsonObject)

      // Note: In practice, these would be separate operations
      const nameUpdate = setter.name.$set('New Name')
      const profileUpdate = setter.profile.avatar.$set('new-avatar.jpg')
      const tagsUpdate = setter.tags.$set(['updated', 'tags'])

      const nameQuery = dialect.sqlToQuery(nameUpdate)
      const profileQuery = dialect.sqlToQuery(profileUpdate)
      const tagsQuery = dialect.sqlToQuery(tagsUpdate)

      expect(nameQuery.sql).toBe(
        `jsonb_set(${jsonObjectSql}, array['name']::text[], $1::jsonb, true)`,
      )
      expect(profileQuery.sql).toBe(
        `jsonb_set(${jsonObjectSql}, array['profile','avatar']::text[], $1::jsonb, true)`,
      )
      expect(tagsQuery.sql).toBe(
        `jsonb_set(${jsonObjectSql}, array['tags']::text[], jsonb_build_array($1::jsonb,$2::jsonb), true)`,
      )

      expect(nameQuery.params).toEqual(
        ['New Name'].map((v) => JSON.stringify(v)),
      )
      expect(profileQuery.params).toEqual(
        ['new-avatar.jpg'].map((v) => JSON.stringify(v)),
      )
      expect(tagsQuery.params).toEqual(
        ['updated', 'tags'].map((v) => JSON.stringify(v)),
      )
    })

    it('handles very deep nesting', () => {
      const deepJson = sql<{
        level1: {
          level2: {
            level3: {
              level4: {
                value: string
              }
            }
          }
        }
      }>`'{"level1": {"level2": {"level3": {"level4": {"value": "deep"}}}}}'::jsonb`

      const setter = jsonSet(deepJson)
      const result = setter.level1.level2.level3.level4.value.$set('very-deep')
      const query = dialect.sqlToQuery(result)

      expect(query.params).toEqual(['very-deep'].map((v) => JSON.stringify(v)))
      expect(query.sql).toBe(
        `jsonb_set('{"level1": {"level2": {"level3": {"level4": {"value": "deep"}}}}}'::jsonb, array['level1','level2','level3','level4','value']::text[], $1::jsonb, true)`,
      )
    })
  })
})
