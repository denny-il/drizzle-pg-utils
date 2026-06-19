import { sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { coalesce } from '../../src/json/index.ts'
import { jsonCoalesce } from '../../src/json/operations/coalesce.ts'
import {
  createDatabase,
  dialect,
  executeQuery,
  type TestDatabase,
} from '../utils.ts'

describe('JSON Coalesce SQL injection handling', () => {
  let db: TestDatabase

  beforeAll(async () => {
    db = await createDatabase()
  })

  const jsonNull = sql<null>`'null'::jsonb`

  it('keeps malicious string fallbacks in a jsonb parameter', async () => {
    const fallback = `x'::jsonb); drop table users; select pg_sleep(10); --`
    const result = jsonCoalesce(jsonNull, fallback)
    const query = dialect.sqlToQuery(result)

    expect(query.sql).toBe(
      `coalesce(nullif('null'::jsonb, 'null'::jsonb), $1::jsonb)`,
    )
    expect(query.params).toEqual([JSON.stringify(fallback)])
    expect(await executeQuery(db, result)).toBe(fallback)
  })

  it('uses the same safe fallback path for SQL NULL sources', async () => {
    const fallback = `sql-null'); drop table users; --`
    const result = jsonCoalesce(sql<null>`NULL::jsonb`, fallback)
    const query = dialect.sqlToQuery(result)

    expect(query.sql).toBe(
      `coalesce(nullif(NULL::jsonb, 'null'::jsonb), $1::jsonb)`,
    )
    expect(query.params).toEqual([JSON.stringify(fallback)])
    expect(await executeQuery(db, result)).toBe(fallback)
  })

  it('escapes malicious object keys and parameterizes object values', async () => {
    const maliciousKey = `name'); drop table users; --`
    const nestedKey = `child'); delete from audit; --`
    const maliciousValue = `value'); select pg_sleep(10); --`
    const fallback = {
      [maliciousKey]: maliciousValue,
      nested: {
        [nestedKey]: true,
      },
    }
    const result = jsonCoalesce(jsonNull, fallback)
    const query = dialect.sqlToQuery(result)

    expect(query.sql).toBe(
      `coalesce(nullif('null'::jsonb, 'null'::jsonb), jsonb_build_object('name''); drop table users; --', $1::jsonb,'nested', jsonb_build_object('child''); delete from audit; --', $2::jsonb)))`,
    )
    expect(query.params).toEqual([
      JSON.stringify(maliciousValue),
      JSON.stringify(true),
    ])
    expect(await executeQuery(db, result)).toEqual(fallback)
  })

  it('parameterizes malicious array fallback values', async () => {
    const objectKey = `arr-key'); vacuum; --`
    const objectValue = `arr-value'); reindex database postgres; --`
    const fallback = [
      `zero'); drop schema public cascade; --`,
      {
        [objectKey]: objectValue,
      },
      null,
    ]
    const result = jsonCoalesce(jsonNull, fallback)
    const query = dialect.sqlToQuery(result)

    expect(query.sql).toBe(
      `coalesce(nullif('null'::jsonb, 'null'::jsonb), jsonb_build_array($1::jsonb,jsonb_build_object('arr-key''); vacuum; --', $2::jsonb),$3::jsonb))`,
    )
    expect(query.params).toEqual([
      JSON.stringify(fallback[0]),
      JSON.stringify((fallback[1] as Record<string, string>)[objectKey]),
      JSON.stringify(null),
    ])
    expect(await executeQuery(db, result)).toEqual(fallback)
  })

  it('treats interpolated source payloads as values, not SQL text', async () => {
    const sourcePayload = `source'); drop table users; --`
    const fallback = `fallback'); drop table users; --`
    const source = sql<string>`${JSON.stringify(sourcePayload)}::jsonb`
    const result = jsonCoalesce(source, fallback)
    const query = dialect.sqlToQuery(result)

    expect(query.sql).toBe(
      `coalesce(nullif($1::jsonb, 'null'::jsonb), $2::jsonb)`,
    )
    expect(query.params).toEqual([
      JSON.stringify(sourcePayload),
      JSON.stringify(fallback),
    ])
    expect(await executeQuery(db, result)).toBe(sourcePayload)
  })

  it('documents SQLWrapper fallback trust boundary while converting safe expressions', async () => {
    const result = jsonCoalesce(jsonNull, sql<number>`42::integer`)
    const query = dialect.sqlToQuery(result)

    expect(query.sql).toBe(
      `coalesce(nullif('null'::jsonb, 'null'::jsonb), to_jsonb(42::integer))`,
    )
    expect(query.params).toEqual([])
    expect(await executeQuery(db, result)).toBe(42)
  })

  it('keeps SQLWrapper fallback parameters bound inside to_jsonb', async () => {
    const fallback = `wrapped'); drop table users; --`
    const result = jsonCoalesce(jsonNull, sql<string>`${fallback}::text`)
    const query = dialect.sqlToQuery(result)

    expect(query.sql).toBe(
      `coalesce(nullif('null'::jsonb, 'null'::jsonb), to_jsonb($1::text))`,
    )
    expect(query.params).toEqual([fallback])
    expect(await executeQuery(db, result)).toBe(fallback)
  })

  it('uses same parameterization through public coalesce alias', async () => {
    const fallback = `alias'); drop table users; --`
    const result = coalesce(jsonNull, fallback)
    const query = dialect.sqlToQuery(result)

    expect(query.sql).toBe(
      `coalesce(nullif('null'::jsonb, 'null'::jsonb), $1::jsonb)`,
    )
    expect(query.params).toEqual([JSON.stringify(fallback)])
    expect(await executeQuery(db, result)).toBe(fallback)
  })
})
