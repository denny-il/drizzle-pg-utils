import { sql } from 'drizzle-orm'
import type { PgliteDatabase } from 'drizzle-orm/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { build } from '../../src/json/index.ts'
import { jsonBuild } from '../../src/json/operations/build.ts'
import { createDatabase, dialect, executeQuery } from '../utils.ts'

let db: PgliteDatabase

beforeAll(async () => {
  db = await createDatabase()
})

const jsonParam = (value: unknown) => JSON.stringify(value)

const sqlString = (value: string) => `'${value.replaceAll("'", "''")}'`

describe('JSON Build SQL injection handling', () => {
  it('keeps malicious primitive strings parameterized', async () => {
    const payloads = [
      `"}'::jsonb); select pg_sleep(99); --`,
      `value'); drop table users; --`,
      `\\' union select current_user --`,
      `comment /* break */ close */ ; select 1`,
    ]

    for (const payload of payloads) {
      const query = dialect.sqlToQuery(jsonBuild(payload))

      expect(query.sql).toBe('$1::jsonb')
      expect(query.sql).not.toContain(payload)
      expect(query.params).toEqual([jsonParam(payload)])
      await expect(executeQuery(db, jsonBuild(payload))).resolves.toBe(payload)
    }
  })

  it('escapes malicious object keys as SQL string literals and preserves them at runtime', async () => {
    const selectKey = `name'); select pg_sleep(99); --`
    const commaKey = `jsonb_build_object('pwned', true), 'safe`
    const pathKey = `profile'} || '{"admin":true}'::jsonb || '{"profile`
    const nestedKey = `nested'); drop schema public cascade; --`
    const value = {
      [selectKey]: 'kept',
      [commaKey]: 7,
      [pathKey]: {
        [nestedKey]: false,
      },
    }

    const query = dialect.sqlToQuery(jsonBuild(value))

    expect(query.params).toEqual([
      jsonParam('kept'),
      jsonParam(7),
      jsonParam(false),
    ])
    expect(query.sql).toContain(sqlString(selectKey))
    expect(query.sql).toContain(sqlString(commaKey))
    expect(query.sql).toContain(sqlString(pathKey))
    expect(query.sql).toContain(sqlString(nestedKey))
    await expect(executeQuery(db, jsonBuild(value))).resolves.toEqual(value)
  })

  it('keeps nested malicious values parameterized through objects and arrays', async () => {
    const valuePayload = `"}; drop schema public cascade; --`
    const secondPayload = `array item'); select version(); --`
    const keyPayload = `items'); select current_database(); --`
    const nestedPayload = `last value' /* not SQL */ --`
    const value = {
      plain: valuePayload,
      keep: [
        'prefix',
        secondPayload,
        undefined,
        { [keyPayload]: nestedPayload },
      ],
      skip: undefined,
    } as any

    const query = dialect.sqlToQuery(jsonBuild(value))

    expect(query.params).toEqual([
      jsonParam(valuePayload),
      jsonParam('prefix'),
      jsonParam(secondPayload),
      jsonParam(null),
      jsonParam(nestedPayload),
    ])
    expect(query.sql).not.toContain(valuePayload)
    expect(query.sql).not.toContain(secondPayload)
    expect(query.sql).not.toContain(nestedPayload)
    expect(query.sql).not.toContain('skip')
    expect(query.sql).toContain(sqlString(keyPayload))
    await expect(executeQuery(db, jsonBuild(value))).resolves.toEqual({
      plain: valuePayload,
      keep: ['prefix', secondPayload, null, { [keyPayload]: nestedPayload }],
    })
  })

  it('preserves SQLWrapper params while treating raw SQL as caller-controlled SQL', async () => {
    const barePayload = `bare'); select pg_sleep(99); --`
    const bareParam = sql<string>`${barePayload}`
    const computed = sql<string>`lower(${'MIXED'})`
    const trustedRawJson = sql.raw(`'{"trusted":true}'::jsonb`)

    const bareQuery = dialect.sqlToQuery(jsonBuild({ safe: bareParam }))
    const computedQuery = dialect.sqlToQuery(jsonBuild({ computed }))
    const rawQuery = dialect.sqlToQuery(jsonBuild(trustedRawJson))

    expect(bareQuery.sql).toBe(`jsonb_build_object('safe', $1)`)
    expect(bareQuery.params).toEqual([barePayload])
    expect(computedQuery.sql).toBe(
      `jsonb_build_object('computed', to_jsonb(lower($1)))`,
    )
    expect(computedQuery.params).toEqual(['MIXED'])
    expect(rawQuery.sql).toBe(`to_jsonb('{"trusted":true}'::jsonb)`)
    expect(rawQuery.params).toEqual([])
    await expect(
      executeQuery(db, jsonBuild({ computed, trustedRawJson })),
    ).resolves.toEqual({
      computed: 'mixed',
      trustedRawJson: { trusted: true },
    })
  })

  it('applies the same escaping and runtime behavior through the public build alias', async () => {
    const key = `alias'); select pg_sleep(99); --`
    const payload = `alias value'); drop table test; --`
    const value = {
      [key]: payload,
      nested: [payload],
    }

    const query = dialect.sqlToQuery(build(value))

    expect(query.params).toEqual([jsonParam(payload), jsonParam(payload)])
    expect(query.sql).toContain(sqlString(key))
    expect(query.sql).not.toContain(payload)
    await expect(executeQuery(db, build(value))).resolves.toEqual(value)
  })
})
