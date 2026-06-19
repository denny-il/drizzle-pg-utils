import { sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { arrayPush } from '../../src/json/index.ts'
import { jsonArrayPush } from '../../src/json/operations/array.ts'
import {
  createDatabase,
  dialect,
  executeQuery,
  type TestDatabase,
} from '../utils.ts'

let db: TestDatabase

beforeAll(async () => {
  db = await createDatabase()
})

const jsonParam = (value: unknown) => JSON.stringify(value)

describe('JSON Array Push SQL injection handling', () => {
  const sourceSql = `'[]'::jsonb`
  const source = sql<unknown[]>`${sql.raw(sourceSql)}`

  it('keeps malicious string elements parameterized and preserves them at runtime', async () => {
    await db.execute(
      sql`create table array_push_sentinel (id integer primary key)`,
    )
    await db.execute(sql`insert into array_push_sentinel (id) values (1)`)

    const payloads = [
      `"}'::jsonb); drop table array_push_sentinel; --`,
      `value'); select pg_sleep(10); --`,
      `\\' union select current_user --`,
      `comment /* break */ close */ ; select 1`,
    ]
    const result = jsonArrayPush(source, ...payloads)
    const query = dialect.sqlToQuery(result)

    expect(query.params).toEqual(payloads.map(jsonParam))
    expect(query.sql).toBe(
      `coalesce(nullif(${sourceSql}, 'null'::jsonb), '[]'::jsonb) || jsonb_build_array($1::jsonb, $2::jsonb, $3::jsonb, $4::jsonb)`,
    )
    for (const payload of payloads) expect(query.sql).not.toContain(payload)
    await expect(executeQuery(db, result)).resolves.toEqual(payloads)

    await expect(
      executeQuery(db, sql`(select count(*)::int from array_push_sentinel)`),
    ).resolves.toBe(1)
  })

  it('keeps malicious object keys and values inside one JSONB parameter', async () => {
    const key = `key'); drop table array_push_sentinel; --`
    const nestedKey = `nested'); select pg_sleep(10); --`
    const valuePayload = `value'); drop table array_push_sentinel; --`
    const value = {
      [key]: valuePayload,
      nested: {
        [nestedKey]: [valuePayload],
      },
      omitted: undefined,
    } as any
    const expectedValue = {
      [key]: valuePayload,
      nested: {
        [nestedKey]: [valuePayload],
      },
    }
    const result = jsonArrayPush(source, value)
    const query = dialect.sqlToQuery(result)

    expect(query.params).toEqual([jsonParam(value)])
    expect(query.sql).toBe(
      `coalesce(nullif(${sourceSql}, 'null'::jsonb), '[]'::jsonb) || jsonb_build_array($1::jsonb)`,
    )
    expect(query.sql).not.toContain(key)
    expect(query.sql).not.toContain(nestedKey)
    expect(query.sql).not.toContain(valuePayload)
    await expect(executeQuery(db, result)).resolves.toEqual([expectedValue])
  })

  it('keeps malicious nested arrays as JSON data', async () => {
    const firstPayload = `array item'); select version(); --`
    const secondPayload = `nested array item'); drop schema public cascade; --`
    const pushedArray = [
      firstPayload,
      [secondPayload, undefined],
      { safe: firstPayload },
    ] as any
    const expectedArray = [
      firstPayload,
      [secondPayload, null],
      { safe: firstPayload },
    ]
    const result = jsonArrayPush(source, pushedArray)
    const query = dialect.sqlToQuery(result)

    expect(query.params).toEqual([jsonParam(pushedArray)])
    expect(query.sql).toBe(
      `coalesce(nullif(${sourceSql}, 'null'::jsonb), '[]'::jsonb) || jsonb_build_array($1::jsonb)`,
    )
    expect(query.sql).not.toContain(firstPayload)
    expect(query.sql).not.toContain(secondPayload)
    await expect(executeQuery(db, result)).resolves.toEqual([expectedArray])
  })

  it('converts pushed undefined and null to JSON null values', async () => {
    const result = jsonArrayPush(source, undefined, null)
    const query = dialect.sqlToQuery(result)

    expect(query.params).toEqual(['null', 'null'])
    expect(query.sql).toBe(
      `coalesce(nullif(${sourceSql}, 'null'::jsonb), '[]'::jsonb) || jsonb_build_array($1::jsonb, $2::jsonb)`,
    )
    await expect(executeQuery(db, result)).resolves.toEqual([null, null])
  })

  it('preserves SQLWrapper placeholders while treating wrapper SQL as caller-controlled', async () => {
    const barePayload = `bare'); drop table array_push_sentinel; --`
    const computedPayload = `computed'); select pg_sleep(10); --`
    const bareParam = sql<string>`${barePayload}`
    const typedParam = sql<string>`${barePayload}::text`
    const computed = sql<
      Record<string, string>
    >`jsonb_build_object('safe', ${computedPayload})`
    const typedComputed = sql<
      Record<string, string>
    >`jsonb_build_object('safe', ${computedPayload}::text)`
    const result = jsonArrayPush(source, bareParam, computed)
    const query = dialect.sqlToQuery(result)

    expect(query.params).toEqual([barePayload, computedPayload])
    expect(query.sql).toBe(
      `coalesce(nullif(${sourceSql}, 'null'::jsonb), '[]'::jsonb) || jsonb_build_array($1, jsonb_build_object('safe', $2))`,
    )
    expect(query.sql).not.toContain(barePayload)
    expect(query.sql).not.toContain(computedPayload)

    const runtimeResult = jsonArrayPush(source, typedParam, typedComputed)
    const runtimeQuery = dialect.sqlToQuery(runtimeResult)

    expect(runtimeQuery.params).toEqual([barePayload, computedPayload])
    expect(runtimeQuery.sql).toBe(
      `coalesce(nullif(${sourceSql}, 'null'::jsonb), '[]'::jsonb) || jsonb_build_array($1::text, jsonb_build_object('safe', $2::text))`,
    )
    await expect(executeQuery(db, runtimeResult)).resolves.toEqual([
      barePayload,
      { safe: computedPayload },
    ])
  })

  it('documents source SQL misuse while keeping pushed values parameterized', () => {
    const rawSourceSql = `'[]'::jsonb); select pg_sleep(10); --`
    const payload = `value'); drop table array_push_sentinel; --`
    const unsafeSource = sql<unknown[]>`${sql.raw(rawSourceSql)}`
    const result = jsonArrayPush(unsafeSource, payload)
    const query = dialect.sqlToQuery(result)

    expect(query.params).toEqual([jsonParam(payload)])
    expect(query.sql).toContain(rawSourceSql)
    expect(query.sql).toContain('pg_sleep')
    expect(query.sql).not.toContain(payload)
  })

  it('applies the same value parameterization through public arrayPush alias', async () => {
    const payload = `alias'); drop table array_push_sentinel; --`
    const directQuery = dialect.sqlToQuery(jsonArrayPush(source, payload))
    const aliasResult = arrayPush(source, payload)
    const aliasQuery = dialect.sqlToQuery(aliasResult)

    expect(aliasQuery).toEqual(directQuery)
    expect(aliasQuery.params).toEqual([jsonParam(payload)])
    expect(aliasQuery.sql).not.toContain(payload)
    await expect(executeQuery(db, aliasResult)).resolves.toEqual([payload])
  })
})
