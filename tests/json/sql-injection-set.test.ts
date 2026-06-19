import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { set as jsonSetAlias } from '../../src/json/index.ts'
import { jsonSet } from '../../src/json/operations/set.ts'
import { createDatabase, dialect, executeQuery } from '../utils.ts'

describe('JSON Set SQL injection hardening', () => {
  const sourceSql = `'{}'::jsonb`
  const source = sql<Record<string, unknown>>`${sql.raw(sourceSql)}`

  it('keeps malicious path components inside escaped text array literals', () => {
    const result =
      jsonSet(source)["x'), true); drop table users; --"].nested['a,b{c}'].$set(
        "v'); select 1; --",
      )
    const query = dialect.sqlToQuery(result)

    expect(query.sql).toBe(
      `jsonb_set(${sourceSql}, array['x''), true); drop table users; --','nested','a,b{c}']::text[], $1::jsonb, true)`,
    )
    expect(query.params).toEqual([JSON.stringify("v'); select 1; --")])
  })

  it('keeps malicious object keys inside jsonb_build_object key literals', () => {
    const key = "k'); drop table audit; --"
    const result = jsonSet(source).payload.$set({
      [key]: "v'); select 1; --",
      safe: 'ok',
    })
    const query = dialect.sqlToQuery(result)

    expect(query.sql).toBe(
      `jsonb_set(${sourceSql}, array['payload']::text[], jsonb_build_object('k''); drop table audit; --', $1::jsonb,'safe', $2::jsonb), true)`,
    )
    expect(query.params).toEqual([
      JSON.stringify("v'); select 1; --"),
      JSON.stringify('ok'),
    ])
  })

  it('keeps $default path and value inputs escaped or parameterized', () => {
    const defaultKey = "d'); drop table d; --"
    const result = jsonSet(source)
      ["cfg'); drop table cfg; --"].$default({
        [defaultKey]: "default'); --",
      })
      ["leaf'); drop table l; --"].$set("final'); --", false)
    const query = dialect.sqlToQuery(result)

    expect(query.sql).toBe(
      `jsonb_set(jsonb_set(coalesce(nullif(${sourceSql}, 'null'::jsonb), '{}'::jsonb), array['cfg''); drop table cfg; --']::text[], coalesce(nullif(jsonb_extract_path(${sourceSql}, 'cfg''); drop table cfg; --'), 'null'::jsonb), jsonb_build_object('d''); drop table d; --', $1::jsonb)), true), array['cfg''); drop table cfg; --','leaf''); drop table l; --']::text[], $2::jsonb, false)`,
    )
    expect(query.params).toEqual([
      JSON.stringify("default'); --"),
      JSON.stringify("final'); --"),
    ])
  })

  it('coerces createMissing SQLWrapper misuse to boolean before SQL generation', () => {
    const rawCreateMissing = sql.raw('true); drop table users; --')

    const setQuery = dialect.sqlToQuery(
      jsonSet(source).payload.$set('safe', rawCreateMissing as any),
    )
    const defaultQuery = dialect.sqlToQuery(
      jsonSet(source)
        .payload.$default('safe', 0 as any)
        .leaf.$set('safe'),
    )

    expect(setQuery.sql).toBe(
      `jsonb_set(${sourceSql}, array['payload']::text[], $1::jsonb, true)`,
    )
    expect(setQuery.params).toEqual([JSON.stringify('safe')])
    expect(defaultQuery.sql).toBe(
      `jsonb_set(jsonb_set(coalesce(nullif(${sourceSql}, 'null'::jsonb), '{}'::jsonb), array['payload']::text[], coalesce(nullif(jsonb_extract_path(${sourceSql}, 'payload'), 'null'::jsonb), $1::jsonb), false), array['payload','leaf']::text[], $2::jsonb, true)`,
    )
    expect(defaultQuery.params).toEqual([
      JSON.stringify('safe'),
      JSON.stringify('safe'),
    ])
    expect(setQuery.sql).not.toContain('drop table')
    expect(defaultQuery.sql).not.toContain('drop table')
  })

  it('treats plain malicious string values as JSON params, not SQL', () => {
    const result = jsonSet(source).payload.$set("'}::jsonb); select 1; --")
    const query = dialect.sqlToQuery(result)

    expect(query.sql).toBe(
      `jsonb_set(${sourceSql}, array['payload']::text[], $1::jsonb, true)`,
    )
    expect(query.params).toEqual([JSON.stringify("'}::jsonb); select 1; --")])
  })

  it('keeps bare SQLWrapper params parameterized', () => {
    const result = jsonSet(source).payload.$set(sql`${"x'); select 1; --"}`)
    const query = dialect.sqlToQuery(result)

    expect(query.sql).toBe(
      `jsonb_set(${sourceSql}, array['payload']::text[], $1, true)`,
    )
    expect(query.params).toEqual(["x'); select 1; --"])
  })

  it('embeds non-bare SQLWrapper values as intentional SQL expressions', () => {
    const result = jsonSet(source).payload.$set(
      sql`jsonb_build_object('safe', ${'x'}::text)`,
    )
    const query = dialect.sqlToQuery(result)

    expect(query.sql).toBe(
      `jsonb_set(${sourceSql}, array['payload']::text[], to_jsonb(jsonb_build_object('safe', $1::text)), true)`,
    )
    expect(query.params).toEqual(['x'])
  })

  it('public set alias has same escaping behavior as jsonSet', () => {
    const result =
      jsonSetAlias(source)["alias'); drop table alias; --"].$set('ok')
    const query = dialect.sqlToQuery(result)

    expect(query.sql).toBe(
      `jsonb_set(${sourceSql}, array['alias''); drop table alias; --']::text[], $1::jsonb, true)`,
    )
    expect(query.params).toEqual([JSON.stringify('ok')])
  })

  it('rejects root-level $set and $default misuse', () => {
    expect(() => jsonSet(source).$set({})).toThrow(
      'Cannot set default value at root level',
    )
    expect(() => jsonSet(source).$default({})).toThrow(
      'Cannot set default value at root level',
    )
  })

  it('updates exact malicious path keys at runtime', async () => {
    const db = await createDatabase()
    const key = "x'), true); drop table users; --"
    const leaf = 'a,b{c}'
    const runtimeSource = sql<
      Record<string, { [key: string]: string }>
    >`'{"x''), true); drop table users; --": {"a,b{c}": "old"}}'::jsonb`

    const result = await executeQuery(
      db,
      jsonSet(runtimeSource)[key][leaf].$set("v'); select 1; --"),
    )

    expect(result).toEqual({
      [key]: {
        [leaf]: "v'); select 1; --",
      },
    })
  }, 15_000)

  it('writes malicious object keys and values as JSON data at runtime', async () => {
    const db = await createDatabase()
    const key = "k'); drop table audit; --"

    const result = await executeQuery(
      db,
      jsonSet(source).payload.$set({
        [key]: "v'); select 1; --",
      }),
    )

    expect(result).toEqual({
      payload: {
        [key]: "v'); select 1; --",
      },
    })
  })

  it('applies $default to exact malicious keys at runtime', async () => {
    const db = await createDatabase()
    const key = "cfg'); drop table cfg; --"
    const defaultKey = "d'); drop table d; --"
    const leaf = "leaf'); drop table l; --"

    const result = await executeQuery(
      db,
      jsonSet(source)
        [key].$default({
          [defaultKey]: "default'); --",
        })
        [leaf].$set("final'); --"),
    )

    expect(result).toEqual({
      [key]: {
        [defaultKey]: "default'); --",
        [leaf]: "final'); --",
      },
    })
  })
})
