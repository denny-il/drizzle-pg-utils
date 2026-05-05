import { type SQL, sql } from 'drizzle-orm'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { jsonBuild } from '../../src/json/operations/build.ts'
import {
  jsonContains,
  type SQLJSONContains,
} from '../../src/json/operations/contains.ts'
import { dialect, table } from '../utils.ts'

describe('JSON Contains', () => {
  type JsonType = {
    kind: 'alpha' | 'beta'
    profile: {
      email: string
      status: 'active' | 'inactive'
    }
    tags: Array<{ name: string; weight: number }>
  }

  const jsonObjectSql = `'{"kind":"alpha","profile":{"email":"user@example.com","status":"active"},"tags":[{"name":"tag1","weight":1}]}'::jsonb`
  const jsonObject = sql<JsonType>`${sql.raw(jsonObjectSql)}`

  it('creates typed proxy containment helpers', () => {
    const contains = jsonContains(jsonObject)

    expect(contains).toBeDefined()
    expectTypeOf(contains).toEqualTypeOf<SQLJSONContains<SQL<JsonType>>>()
    expectTypeOf(
      contains.profile.email.$contains('user@example.com'),
    ).toEqualTypeOf<SQL<boolean>>()
  })

  it('generates root containment SQL for nested object values', () => {
    const result = jsonContains(jsonObject, {
      profile: { email: 'user@example.com' },
    })
    const query = dialect.sqlToQuery(result)

    expect(query.params).toEqual([
      JSON.stringify({ profile: { email: 'user@example.com' } }),
    ])
    expect(query.sql).toBe(`${jsonObjectSql} @> $1::jsonb`)
    expectTypeOf(result).toEqualTypeOf<SQL<boolean>>()
  })

  it('generates root containment SQL from nested proxy paths', () => {
    const result = jsonContains(jsonObject).profile.$contains({
      email: 'user@example.com',
    })
    const query = dialect.sqlToQuery(result)

    expect(query.params).toEqual([
      JSON.stringify({ profile: { email: 'user@example.com' } }),
    ])
    expect(query.sql).toBe(`${jsonObjectSql} @> $1::jsonb`)
  })

  it('generates root containment SQL from scalar proxy paths', () => {
    const result = jsonContains(jsonObject).profile.status.$contains('active')
    const query = dialect.sqlToQuery(result)

    expect(query.params).toEqual([
      JSON.stringify({ profile: { status: 'active' } }),
    ])
    expect(query.sql).toBe(`${jsonObjectSql} @> $1::jsonb`)
  })

  it('generates root containment SQL for array values', () => {
    const result = jsonContains(jsonObject, {
      tags: [{ name: 'tag1' }],
    })
    const query = dialect.sqlToQuery(result)

    expect(query.params).toEqual([JSON.stringify({ tags: [{ name: 'tag1' }] })])
    expect(query.sql).toBe(`${jsonObjectSql} @> $1::jsonb`)
  })

  it('generates root containment SQL from array proxy paths', () => {
    const result = jsonContains(jsonObject).tags.$contains([{ name: 'tag1' }])
    const query = dialect.sqlToQuery(result)

    expect(query.params).toEqual([JSON.stringify({ tags: [{ name: 'tag1' }] })])
    expect(query.sql).toBe(`${jsonObjectSql} @> $1::jsonb`)
  })

  it('accepts SQL containment values', () => {
    const result = jsonContains(
      jsonObject,
      sql<JsonType>`jsonb_build_object('kind', 'alpha')`,
    )
    const query = dialect.sqlToQuery(result)

    expect(query.params).toEqual([])
    expect(query.sql).toBe(
      `${jsonObjectSql} @> jsonb_build_object('kind', 'alpha')`,
    )
  })

  it('accepts jsonBuild output as containment value', () => {
    const result = jsonContains(
      jsonObject,
      jsonBuild({
        profile: { status: 'active' },
      }),
    )
    const query = dialect.sqlToQuery(result)

    expect(query.params).toEqual([JSON.stringify('active')])
    expect(query.sql).toBe(
      `${jsonObjectSql} @> jsonb_build_object('profile', jsonb_build_object('status', $1::jsonb))`,
    )
  })

  it('works with table columns', () => {
    const result = jsonContains(table.jsoncol, { some: 'json' })
    const query = dialect.sqlToQuery(result)

    expect(query.params).toEqual([JSON.stringify({ some: 'json' })])
    expect(query.sql).toBe(`"test"."jsoncol" @> $1::jsonb`)
  })
})
