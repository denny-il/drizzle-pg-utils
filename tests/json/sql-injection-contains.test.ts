import { sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import * as json from '../../src/json/index.ts'
import { jsonBuild } from '../../src/json/operations/build.ts'
import { jsonContains } from '../../src/json/operations/contains.ts'
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

describe('JSON Contains SQL injection and misuse resistance', () => {
  it('keeps malicious direct containment values parameterized', async () => {
    const source = sql`'{"safe":true,"payload":"kept"}'::jsonb`
    const maliciousValue = `value'); drop table contains_sentinel; --`
    const result = jsonContains(source, { payload: maliciousValue })
    const query = dialect.sqlToQuery(result)

    expect(query.sql).toBe(
      `'{"safe":true,"payload":"kept"}'::jsonb @> $1::jsonb`,
    )
    expect(query.sql).not.toContain(maliciousValue)
    expect(query.params).toEqual([JSON.stringify({ payload: maliciousValue })])
    await expect(executeQuery(db, result)).resolves.toBe(false)
  })

  it('keeps malicious proxy path and value data parameterized', async () => {
    const maliciousPath = `profile"} || '{"admin":true}'::jsonb || '{"profile`
    const maliciousValue = `dark'); select pg_sleep(99); --`
    const source = sql`'{"profile\":{\"theme\":\"dark\"}}'::jsonb`
    const result = jsonContains(source)[maliciousPath].$contains(maliciousValue)
    const query = dialect.sqlToQuery(result)

    expect(query.sql).toBe(`'{"profile":{"theme":"dark"}}'::jsonb @> $1::jsonb`)
    expect(query.sql).not.toContain(maliciousPath)
    expect(query.sql).not.toContain(maliciousValue)
    expect(query.params).toEqual([
      JSON.stringify({ [maliciousPath]: maliciousValue }),
    ])
    await expect(executeQuery(db, result)).resolves.toBe(false)
  })

  it('preserves SQLWrapper placeholders and params as caller-controlled SQL', () => {
    const payload = `wrapped'); drop table contains_sentinel; --`
    const source = sql`'{"payload":"wrapped"}'::jsonb`
    const result = jsonContains(
      source,
      sql`jsonb_build_object('payload', ${payload})`,
    )
    const query = dialect.sqlToQuery(result)

    expect(query.sql).toBe(
      `'{"payload":"wrapped"}'::jsonb @> jsonb_build_object('payload', $1)`,
    )
    expect(query.sql).not.toContain(payload)
    expect(query.params).toEqual([payload])
  })

  it('public contains alias generates the same SQL and params as jsonContains', () => {
    const source = jsonBuild({ stable: true })
    const value = {
      payload: `alias'); drop table contains_sentinel; --`,
    }

    expect(dialect.sqlToQuery(json.contains(source, value))).toEqual(
      dialect.sqlToQuery(jsonContains(source, value)),
    )
  })

  it('preserves malicious containment data at runtime without executing it', async () => {
    await db.execute(
      sql`create table contains_sentinel (id integer primary key)`,
    )
    await db.execute(sql`insert into contains_sentinel (id) values (1)`)

    const maliciousKey = `key'); drop table contains_sentinel; --`
    const maliciousValue = `value'); drop table contains_sentinel; --`
    const source = jsonBuild({
      safe: true,
      [maliciousKey]: maliciousValue,
    })

    await expect(
      executeQuery(
        db,
        jsonContains(source, { [maliciousKey]: maliciousValue }),
      ),
    ).resolves.toBe(true)
    await expect(
      executeQuery(db, sql`(select count(*)::int from contains_sentinel)`),
    ).resolves.toBe(1)
  })
})
