import { isSQLWrapper, type SQL, sql } from 'drizzle-orm'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { json } from '../../src/index.ts'
import { createDatabase, dialect, executeQuery } from '../utils.ts'

describe('JSON Ref API', () => {
  type Profile = {
    user: {
      id: number
      name: string
      preferences?: {
        theme: 'light' | 'dark'
        notifications: boolean
        tags: string[]
      }
    }
    metadata?: {
      importedAt?: string
    }
  }

  const profileSql = `'{"user":{"id":1,"name":"John","preferences":{"theme":"dark","notifications":true,"tags":["tag1"]}}}'::jsonb`
  const profileExpr = sql<Profile>`${sql.raw(profileSql)}`

  it('keeps existing helpers attached to the ref root', () => {
    expect(typeof json).toBe('function')
    expect(json.access).toBeDefined()
    expect(json.set).toBeDefined()
    expect(json.setPipe).toBeDefined()
    expect(json.contains).toBeDefined()
    expect(json.arrayPush).toBeDefined()
  })

  it('generates access SQL from one path proxy', () => {
    const profile = json(profileExpr)

    const valueQuery = dialect.sqlToQuery(profile.user.preferences.theme.$value)
    const textQuery = dialect.sqlToQuery(profile.user.name.$text)

    expect(valueQuery.params).toEqual([])
    expect(valueQuery.sql).toBe(
      `jsonb_extract_path(${profileSql}, 'user','preferences','theme')`,
    )
    expect(textQuery.params).toEqual([])
    expect(textQuery.sql).toBe(
      `jsonb_extract_path_text(${profileSql}, 'user','name')`,
    )
  })

  it('can rewrap extracted JSON values as a new ref root', () => {
    const profile = json(profileExpr)
    const preferences = json(profile.user.preferences.$value)

    const valueQuery = dialect.sqlToQuery(preferences.theme.$value)
    const textQuery = dialect.sqlToQuery(preferences.theme.$text)

    expect(valueQuery.params).toEqual([])
    expect(valueQuery.sql).toBe(
      `jsonb_extract_path(jsonb_extract_path(${profileSql}, 'user','preferences'), 'theme')`,
    )
    expect(textQuery.params).toEqual([])
    expect(textQuery.sql).toBe(
      `jsonb_extract_path_text(jsonb_extract_path(${profileSql}, 'user','preferences'), 'theme')`,
    )
  })

  it('keeps source expression params bound when extracting through a ref', () => {
    const source = sql<{ a: string }>`${'{"a":"SECRET"}'}::jsonb`
    const result = json(source).a.$value
    const query = dialect.sqlToQuery(result)

    expect(query.params).toEqual(['{"a":"SECRET"}'])
    expect(query.sql).toBe(`jsonb_extract_path($1::jsonb, 'a')`)
  })

  it('treats refs as SQL wrappers for direct SQL interpolation', () => {
    const profile = json(profileExpr)
    const defRef = profile.metadata.$default({ importedAt: 'fallback' })

    expect(isSQLWrapper(profile.user)).toBe(true)
    expect(isSQLWrapper(defRef)).toBe(true)

    const refQuery = dialect.sqlToQuery(sql`select ${profile.user}`)
    expect(refQuery.params).toEqual([])
    expect(refQuery.sql).toBe(
      `select jsonb_extract_path(${profileSql}, 'user')`,
    )

    const defaultQuery = dialect.sqlToQuery(sql`select ${defRef}`)
    expect(defaultQuery.params).toEqual([JSON.stringify('fallback')])
    expect(defaultQuery.sql).toBe(
      `select (with __json_ref_source as (select ${profileSql} as value) select jsonb_set(coalesce(nullif(__json_ref_source.value, 'null'::jsonb), '{}'::jsonb), array['metadata']::text[], coalesce(nullif(jsonb_extract_path(__json_ref_source.value, 'metadata'), 'null'::jsonb), jsonb_build_object('importedAt', $1::jsonb)), true) from __json_ref_source)`,
    )
  })

  it('allows reserved JSON keys through $key escape hatch', () => {
    const sourceSql = `'{"config":{"$value":"kept"}}'::jsonb`
    const source = sql<{ config: { $value: string } }>`${sql.raw(sourceSql)}`
    const result = json(source).config.$key('$value').$text
    const query = dialect.sqlToQuery(result)

    expect(query.params).toEqual([])
    expect(query.sql).toBe(
      `jsonb_extract_path_text(${sourceSql}, 'config','$value')`,
    )
  })

  it('keeps rewrapped mutations scoped to the extracted JSON root', () => {
    const profile = json(profileExpr)
    const preferences = json(profile.user.preferences.$value)
    const result = preferences.theme.$set('light')
    const query = dialect.sqlToQuery(result)

    expect(query.params).toEqual([JSON.stringify('light')])
    expect(query.sql).toBe(
      `jsonb_set(jsonb_extract_path(${profileSql}, 'user','preferences'), array['theme']::text[], $1::jsonb, true)`,
    )
    expectTypeOf(result).toEqualTypeOf<
      SQL<{
        theme: 'light' | 'dark'
        notifications: boolean
        tags: string[]
      } | null>
    >()
  })

  it('generates full-document set SQL from one path proxy', () => {
    const profile = json(profileExpr)
    const result = profile.user.name.$set('Ada')
    const query = dialect.sqlToQuery(result)

    expect(query.params).toEqual([JSON.stringify('Ada')])
    expect(query.sql).toBe(
      `jsonb_set(${profileSql}, array['user','name']::text[], $1::jsonb, true)`,
    )
    expectTypeOf(result).toEqualTypeOf<SQL<Profile>>()
  })

  it('chains default then set from one path proxy', () => {
    const profile = json(profileExpr)
    const result = profile.metadata
      .$default({ importedAt: 'fallback' })
      .importedAt.$set('2026-06-21T00:00:00Z')
    const query = dialect.sqlToQuery(result)

    expect(query.params).toEqual(
      ['fallback', '2026-06-21T00:00:00Z'].map((value) =>
        JSON.stringify(value),
      ),
    )
    expect(query.sql).toBe(
      `jsonb_set((with __json_ref_source as (select ${profileSql} as value) select jsonb_set(coalesce(nullif(__json_ref_source.value, 'null'::jsonb), '{}'::jsonb), array['metadata']::text[], coalesce(nullif(jsonb_extract_path(__json_ref_source.value, 'metadata'), 'null'::jsonb), jsonb_build_object('importedAt', $1::jsonb)), true) from __json_ref_source), array['metadata','importedAt']::text[], $2::jsonb, true)`,
    )
  })

  it('keeps nested containment index-friendly from one path proxy', () => {
    const profile = json(profileExpr)
    const result = profile.user.preferences.$contains({ theme: 'dark' })
    const query = dialect.sqlToQuery(result)

    expect(query.params).toEqual([
      JSON.stringify({ user: { preferences: { theme: 'dark' } } }),
    ])
    expect(query.sql).toBe(`${profileSql} @> $1::jsonb`)
    expectTypeOf(result).toEqualTypeOf<SQL<boolean>>()
  })

  it('supports numeric object keys in ref containment', () => {
    const sourceSql = `'{"0":{"a":1},"-1":{"b":"x"}}'::jsonb`
    const source = sql<{
      '0': { a: number }
      '-1': { b: string }
    }>`${sql.raw(sourceSql)}`
    const result = json(source)['0'].$contains({ a: 1 })
    const query = dialect.sqlToQuery(result)

    expect(query.params).toEqual([JSON.stringify({ '0': { a: 1 } })])
    expect(query.sql).toBe(`${sourceSql} @> $1::jsonb`)
    expectTypeOf(result).toEqualTypeOf<SQL<boolean>>()
  })

  it('keeps malicious ref set paths escaped and values parameterized', () => {
    const sourceSql = `'{}'::jsonb`
    const source = sql<any>`${sql.raw(sourceSql)}`
    const maliciousPath = "x'), true); drop table users; --"
    const maliciousValue = "v'); select 1; --"
    const result = (json(source) as any)[maliciousPath].nested['a,b{c}'].$set(
      maliciousValue,
    )
    const query = dialect.sqlToQuery(result)

    expect(query.sql).toBe(
      `jsonb_set(${sourceSql}, array['x''), true); drop table users; --','nested','a,b{c}']::text[], $1::jsonb, true)`,
    )
    expect(query.params).toEqual([JSON.stringify(maliciousValue)])
  })

  it('keeps malicious ref contains path and value inside one JSON param', () => {
    const sourceSql = `'{"profile":{"theme":"dark"}}'::jsonb`
    const source = sql<any>`${sql.raw(sourceSql)}`
    const maliciousPath = `profile"} || '{"admin":true}'::jsonb || '{"profile`
    const maliciousValue = `dark'); select pg_sleep(99); --`
    const result = (json(source) as any)[maliciousPath].$contains(
      maliciousValue,
    )
    const query = dialect.sqlToQuery(result)

    expect(query.sql).toBe(`${sourceSql} @> $1::jsonb`)
    expect(query.sql).not.toContain(maliciousPath)
    expect(query.sql).not.toContain(maliciousValue)
    expect(query.params).toEqual([
      JSON.stringify({ [maliciousPath]: maliciousValue }),
    ])
  })

  it('keeps malicious ref default object keys escaped and values parameterized', () => {
    const sourceSql = `'{}'::jsonb`
    const source = sql<{ metadata?: Record<string, string> }>`${sql.raw(
      sourceSql,
    )}`
    const maliciousKey = "k'); drop table audit; --"
    const maliciousValue = "v'); select 1; --"
    const result = json(source)
      .metadata.$default({ [maliciousKey]: maliciousValue })
      [maliciousKey].$set('safe')
    const query = dialect.sqlToQuery(result)

    expect(query.sql).toBe(
      `jsonb_set((with __json_ref_source as (select ${sourceSql} as value) select jsonb_set(coalesce(nullif(__json_ref_source.value, 'null'::jsonb), '{}'::jsonb), array['metadata']::text[], coalesce(nullif(jsonb_extract_path(__json_ref_source.value, 'metadata'), 'null'::jsonb), jsonb_build_object('k''); drop table audit; --', $1::jsonb)), true) from __json_ref_source), array['metadata','k''); drop table audit; --']::text[], $2::jsonb, true)`,
    )
    expect(query.params).toEqual([
      JSON.stringify(maliciousValue),
      JSON.stringify('safe'),
    ])
  })

  it('generates full-document array push SQL from one path proxy', () => {
    const profile = json(profileExpr)
    const result = profile.user.preferences.tags.$push('drizzle', 'postgres')
    const query = dialect.sqlToQuery(result)

    expect(query.params).toEqual(
      ['drizzle', 'postgres'].map((value) => JSON.stringify(value)),
    )
    expect(query.sql).toBe(
      `(with __json_ref_source as (select ${profileSql} as value) select jsonb_set(__json_ref_source.value, array['user','preferences','tags']::text[], coalesce(nullif(jsonb_extract_path(__json_ref_source.value, 'user','preferences','tags'), 'null'::jsonb), '[]'::jsonb) || jsonb_build_array($1::jsonb, $2::jsonb), true) from __json_ref_source)`,
    )
    expectTypeOf(result).toEqualTypeOf<SQL<Profile>>()
  })

  it('generates full-document array element set SQL from one path proxy', () => {
    const profile = json(profileExpr)
    const result = profile.user.preferences.tags[0].$set('intro')
    const query = dialect.sqlToQuery(result)

    expect(query.params).toEqual([JSON.stringify('intro')])
    expect(query.sql).toBe(
      `jsonb_set(${profileSql}, array['user','preferences','tags','0']::text[], $1::jsonb, true)`,
    )
    expectTypeOf(result).toEqualTypeOf<SQL<Profile>>()
  })

  it('generates full-document array element delete SQL from one path proxy', () => {
    const profile = json(profileExpr)
    const result = profile.user.preferences.tags[0].$delete()
    const query = dialect.sqlToQuery(result)

    expect(query.params).toEqual([])
    expect(query.sql).toBe(
      `${profileSql} #- array['user','preferences','tags','0']::text[]`,
    )
    expectTypeOf(result).toEqualTypeOf<SQL<Profile>>()
  })

  it('does not throw during string coercion', () => {
    const profile = json(profileExpr)

    expect(() => String(profile.user)).not.toThrow()
  })

  it('chains simple ref JSON mutations through pipe with stable SQL order', () => {
    const result = json.pipe(
      profileExpr,
      (profile) => profile.user.name.$set('Ada'),
      (profile) => profile.user.id.$set(2),
    )
    const query = dialect.sqlToQuery(result)

    expect(query.params).toEqual([JSON.stringify('Ada'), JSON.stringify(2)])
    expect(query.sql).toBe(
      `jsonb_set(jsonb_set(${profileSql}, array['user','name']::text[], $1::jsonb, true), array['user','id']::text[], $2::jsonb, true)`,
    )
    expectTypeOf(result).toEqualTypeOf<SQL<Profile>>()
  })

  it('chains ref JSON mutations through instance pipe', () => {
    const profile = json(profileExpr)
    const result = profile.$pipe(
      (profile) => profile.user.name.$set('Ada'),
      (profile) => profile.user.id.$set(2),
    )
    const query = dialect.sqlToQuery(result)

    expect(query.params).toEqual([JSON.stringify('Ada'), JSON.stringify(2)])
    expect(query.sql).toBe(
      `jsonb_set(jsonb_set(${profileSql}, array['user','name']::text[], $1::jsonb, true), array['user','id']::text[], $2::jsonb, true)`,
    )
    expectTypeOf(result).toEqualTypeOf<SQL<Profile>>()
  })

  it('rejects instance pipe from non-root paths', () => {
    const profile = json(profileExpr)

    expect(() =>
      (profile.metadata as any).$pipe((metadata: any) =>
        metadata.importedAt.$set('2026-06-21T00:00:00Z'),
      ),
    ).toThrow('JSON pipe is only supported at the root path')
  })

  it('chains default and array ref JSON mutations through pipe', () => {
    const result = json.pipe(
      profileExpr,
      (profile) => profile.metadata.$default({ importedAt: 'fallback' }),
      (profile) => profile.user.name.$set('Ada'),
      (profile) => profile.user.preferences.tags.$push('drizzle'),
    )
    const query = dialect.sqlToQuery(result)

    expect(query.params).toEqual(
      ['fallback', 'Ada', 'drizzle'].map((value) => JSON.stringify(value)),
    )
    expect(query.sql).toContain(
      `jsonb_set(coalesce(nullif(__json_ref_source.value, 'null'::jsonb), '{}'::jsonb), array['metadata']::text[]`,
    )
    expect(query.sql).toContain(`array['user','name']::text[]`)
    expect(query.sql).toContain(`array['user','preferences','tags']::text[]`)
    expectTypeOf(result).toEqualTypeOf<SQL<Profile>>()
  })

  it('accepts plain refs as SQL pipe steps', () => {
    const result = json.pipe(profileExpr, (profile) => profile.user as any)
    const query = dialect.sqlToQuery(result)

    expect(query.params).toEqual([])
    expect(query.sql).toBe(`jsonb_extract_path(${profileSql}, 'user')`)
  })

  it('merges object values at the root with existing merge semantics', () => {
    const profile = json(profileExpr)
    const result = profile.$merge({
      metadata: { importedAt: 'api' },
    })
    const query = dialect.sqlToQuery(result)

    expect(query.params).toEqual([JSON.stringify('api')])
    expect(query.sql).toBe(
      `coalesce(${profileSql}, 'null'::jsonb) || coalesce(jsonb_build_object('metadata', jsonb_build_object('importedAt', $1::jsonb)), 'null'::jsonb)`,
    )
    expectTypeOf(result).toEqualTypeOf<SQL<Profile>>()
  })

  it('merges object values into a path and writes back the full document', () => {
    const profile = json(profileExpr)
    const result = profile.user.preferences.$merge({ locale: 'en-US' })
    const query = dialect.sqlToQuery(result)

    expect(query.params).toEqual([JSON.stringify('en-US')])
    expect(query.sql).toBe(
      `(with __json_ref_source as (select ${profileSql} as value) select jsonb_set(__json_ref_source.value, array['user','preferences']::text[], coalesce(coalesce(nullif(jsonb_extract_path(__json_ref_source.value, 'user','preferences'), 'null'::jsonb), '{}'::jsonb), 'null'::jsonb) || coalesce(jsonb_build_object('locale', $1::jsonb), 'null'::jsonb), true) from __json_ref_source)`,
    )
    expectTypeOf(result).toEqualTypeOf<SQL<Profile>>()
  })

  it('merges into missing object paths as objects', async () => {
    const client = await createDatabase()
    const source = sql<{ metadata?: { x: number } }>`'{}'::jsonb`

    try {
      const result = await executeQuery(
        client,
        json(source).metadata.$merge({ x: 1 }),
      )

      expect(result).toEqual({ metadata: { x: 1 } })
    } finally {
      await client.$client.close()
    }
  }, 15_000)

  it('coalesces path reads with a fallback value', () => {
    const profile = json(profileExpr)
    const result = profile.metadata.$coalesce({ importedAt: 'unknown' })
    const query = dialect.sqlToQuery(result)

    expect(query.params).toEqual([JSON.stringify('unknown')])
    expect(query.sql).toBe(
      `coalesce(nullif(jsonb_extract_path(${profileSql}, 'metadata'), 'null'::jsonb), jsonb_build_object('importedAt', $1::jsonb))`,
    )
    expectTypeOf(result).toEqualTypeOf<
      SQL<{ importedAt?: string } | { importedAt: string }>
    >()
  })

  it('preserves path and terminal types', () => {
    const profile = json(profileExpr)
    const strictArray = json(
      sql<{ tags: string[] }>`'{"tags":["tag1"]}'::jsonb`,
    )
    const nullableProfile = json(sql<Profile | null>`NULL::jsonb`)

    expectTypeOf(profile.user.id.$value).toEqualTypeOf<SQL<number>>()
    expectTypeOf(profile.user.name.$text).toEqualTypeOf<SQL<string>>()
    expectTypeOf(profile.user.preferences.theme.$value).toEqualTypeOf<
      SQL<'light' | 'dark' | null>
    >()
    expectTypeOf(profile.user.name.$set('Ada')).toEqualTypeOf<SQL<Profile>>()
    expectTypeOf(
      profile.user.preferences.$contains({ theme: 'dark' }),
    ).toEqualTypeOf<SQL<boolean>>()
    expectTypeOf(
      profile.metadata
        .$default({ importedAt: 'fallback' })
        .importedAt.$set('2026-06-21T00:00:00Z'),
    ).toEqualTypeOf<SQL<Profile>>()
    expectTypeOf(profile.user.preferences.tags.$push('drizzle')).toEqualTypeOf<
      SQL<Profile>
    >()
    expectTypeOf(profile.user.preferences.tags[0].$value).toEqualTypeOf<
      SQL<string | null>
    >()
    expectTypeOf(profile.user.preferences.tags[0].$set('intro')).toEqualTypeOf<
      SQL<Profile>
    >()
    expectTypeOf(profile.user.preferences.tags[0].$delete()).toEqualTypeOf<
      SQL<Profile>
    >()
    expectTypeOf(profile.$pipe((p) => p.user.name.$set('Ada'))).toEqualTypeOf<
      SQL<Profile>
    >()
    expectTypeOf(profile.$merge({ metadata: {} })).toEqualTypeOf<SQL<Profile>>()
    expectTypeOf(
      profile.metadata.$coalesce({ importedAt: 'unknown' }),
    ).toEqualTypeOf<SQL<{ importedAt?: string } | { importedAt: string }>>()
    expectTypeOf(
      json(profile.user.preferences.$value).theme.$value,
    ).toEqualTypeOf<SQL<'light' | 'dark' | null>>()
    expectTypeOf(profile.metadata).toHaveProperty('$default')
    expectTypeOf(profile.user.name).not.toHaveProperty('$default')
    expectTypeOf(profile.user.preferences.tags).not.toHaveProperty('map')
    expectTypeOf(profile.user.name).not.toHaveProperty('$push')
    expectTypeOf(strictArray.tags[0].$value).toEqualTypeOf<SQL<string | null>>()

    const expectTypeErrors = (value: typeof profile) => {
      // @ts-expect-error scalar setters require the scalar value type.
      value.user.name.$set(123)
      // @ts-expect-error containment values must match known JSON literal types.
      value.user.preferences.$contains({ theme: 'blue' })
      // @ts-expect-error array push values must match the array element type.
      value.user.preferences.tags.$push(123)
      // @ts-expect-error array-index containment is not supported.
      value.user.preferences.tags[0].$contains('tag7')
      // @ts-expect-error array-index descendant containment is not supported.
      value.user.preferences.tags[0].length.$contains(4)
      // @ts-expect-error SQL containment values are only supported at root.
      value.user.preferences.$contains(sql`jsonb_build_object('theme', 'dark')`)
      // @ts-expect-error reserved helper names require $key(name).
      value.metadata.$value.$set('bad')
      // @ts-expect-error root default is not exposed.
      nullableProfile.$default({})
      // @ts-expect-error non-root paths do not expose root pipe.
      value.metadata.$pipe()
    }
    expect(expectTypeErrors).toBeTypeOf('function')
  })
})
