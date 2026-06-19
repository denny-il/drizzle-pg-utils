import { sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import * as json from '../../src/json/index.ts'
import { jsonBuild } from '../../src/json/operations/build.ts'
import { jsonMerge } from '../../src/json/operations/merge.ts'
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

describe('JSON Merge SQL injection and misuse resistance', () => {
  it('keeps malicious merge values parameterized when operands are built JSON', () => {
    const maliciousKey = `x'); drop table merge_sentinel; --`
    const maliciousValue = `value'); drop table merge_sentinel; --`
    const base = jsonBuild({ stable: 'base' })
    const mergeObject = Object.create(null) as Record<string, unknown>
    mergeObject[maliciousKey] = maliciousValue

    const result = jsonMerge(base, jsonBuild(mergeObject))
    const query = dialect.sqlToQuery(result)

    expect(query.params).toEqual([
      JSON.stringify('base'),
      JSON.stringify(maliciousValue),
    ])
    expect(query.sql).toBe(
      `coalesce(jsonb_build_object('stable', $1::jsonb), 'null'::jsonb) || coalesce(jsonb_build_object('x''); drop table merge_sentinel; --', $2::jsonb), 'null'::jsonb)`,
    )
    expect(query.sql).not.toContain(maliciousValue)
  })

  it('keeps nested malicious values and array values parameterized through merge', () => {
    const nestedKey = `nested'); select pg_sleep(10); --`
    const nestedValue = `nested-value'); drop table merge_sentinel; --`
    const arrayValue = `array-value'); drop table merge_sentinel; --`
    const nestedObject = Object.create(null) as Record<string, unknown>
    nestedObject[nestedKey] = nestedValue

    const result = jsonMerge(
      jsonBuild({ stable: true }),
      jsonBuild({
        payload: nestedObject,
        values: [arrayValue, sql<string>`${'wrapped value'}`],
      }),
    )
    const query = dialect.sqlToQuery(result)

    expect(query.params).toEqual([
      JSON.stringify(true),
      JSON.stringify(nestedValue),
      JSON.stringify(arrayValue),
      'wrapped value',
    ])
    expect(query.sql).toBe(
      `coalesce(jsonb_build_object('stable', $1::jsonb), 'null'::jsonb) || coalesce(jsonb_build_object('payload', jsonb_build_object('nested''); select pg_sleep(10); --', $2::jsonb),'values', jsonb_build_array($3::jsonb,$4)), 'null'::jsonb)`,
    )
    expect(query.sql).not.toContain(nestedValue)
    expect(query.sql).not.toContain(arrayValue)
  })

  it('preserves SQLWrapper placeholders and params inside merge coalesce wrappers', () => {
    const leftValue = `left'); drop table merge_sentinel; --`
    const rightValue = `right'); drop table merge_sentinel; --`
    const left = sql`jsonb_build_object('left', ${leftValue})`
    const right = sql`jsonb_build_object('right', ${rightValue})`

    const result = jsonMerge(left, right)
    const query = dialect.sqlToQuery(result)

    expect(query.params).toEqual([leftValue, rightValue])
    expect(query.sql).toBe(
      `coalesce(jsonb_build_object('left', $1), 'null'::jsonb) || coalesce(jsonb_build_object('right', $2), 'null'::jsonb)`,
    )
    expect(query.sql).not.toContain(leftValue)
    expect(query.sql).not.toContain(rightValue)
  })

  it('public merge alias generates the same SQL and params as jsonMerge', () => {
    const left = jsonBuild({ stable: 'base' })
    const right = jsonBuild({
      merged: `alias'); drop table merge_sentinel; --`,
    })

    const directQuery = dialect.sqlToQuery(jsonMerge(left, right))
    const aliasQuery = dialect.sqlToQuery(json.merge(left, right))

    expect(aliasQuery).toEqual(directQuery)
  })

  it('treats prototype-ish names as JSON keys when merging built operands', async () => {
    const right = Object.create(null) as Record<string, unknown>
    // biome-ignore lint/suspicious/noProto: test
    right.__proto__ = 'proto-value'
    right.constructor = 'constructor-value'
    right.prototype = 'prototype-value'

    const result = await executeQuery(
      db,
      jsonMerge(jsonBuild({}), jsonBuild(right)),
    )

    expect(Object.keys(result).sort()).toEqual([
      '__proto__',
      'constructor',
      'prototype',
    ])
    expect(Object.hasOwn(result, '__proto__')).toBe(true)
    // biome-ignore lint/suspicious/noProto: test
    expect(result.__proto__).toBe('proto-value')
    expect(result.constructor).toBe('constructor-value')
    expect(result.prototype).toBe('prototype-value')
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
  })

  it('preserves malicious merge data at runtime without executing it', async () => {
    await db.execute(sql`create table merge_sentinel (id integer primary key)`)
    await db.execute(sql`insert into merge_sentinel (id) values (1)`)

    const maliciousKey = `key'); drop table merge_sentinel; --`
    const maliciousValue = `value'); drop table merge_sentinel; --`
    const right = Object.create(null) as Record<string, unknown>
    right[maliciousKey] = maliciousValue

    const result = await executeQuery(
      db,
      jsonMerge(jsonBuild({ safe: true }), jsonBuild(right)),
    )

    expect(result).toEqual({ safe: true, [maliciousKey]: maliciousValue })
    await expect(
      executeQuery(db, sql`(select count(*)::int from merge_sentinel)`),
    ).resolves.toBe(1)
  })
})
