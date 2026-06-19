import { sql } from 'drizzle-orm'
import type { PgliteDatabase } from 'drizzle-orm/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { arrayDelete } from '../../src/json/index.ts'
import { jsonArrayDelete } from '../../src/json/operations/array.ts'
import { createDatabase, dialect, executeQuery } from '../utils.ts'

let db: PgliteDatabase

beforeAll(async () => {
  db = await createDatabase()
})

describe('jsonArrayDelete SQL injection and misuse resistance', () => {
  const sourceSql = `'["zero","one","two","three"]'::jsonb`
  const source = sql<string[]>`${sql.raw(sourceSql)}`

  it.each([
    { index: 0, sqlIndex: '0' },
    { index: 1, sqlIndex: '1' },
    { index: 3, sqlIndex: '3' },
    { index: -1, sqlIndex: '-1' },
    { index: -3, sqlIndex: '-3' },
    { index: 2147483647, sqlIndex: '2147483647' },
    { index: -2147483648, sqlIndex: '-2147483648' },
  ])('renders numeric index $index as an integer operand', (testCase) => {
    const query = dialect.sqlToQuery(jsonArrayDelete(source, testCase.index))

    expect(query.params).toEqual([])
    expect(query.sql).toBe(
      `coalesce(nullif(${sourceSql}, 'null'::jsonb), '[]'::jsonb) - ${testCase.sqlIndex}`,
    )
  })

  it.each([
    { index: 0, expected: ['one', 'two', 'three'] },
    { index: 1, expected: ['zero', 'two', 'three'] },
    { index: -1, expected: ['zero', 'one', 'two'] },
    { index: 99, expected: ['zero', 'one', 'two', 'three'] },
    { index: -99, expected: ['zero', 'one', 'two', 'three'] },
    { index: 2147483647, expected: ['zero', 'one', 'two', 'three'] },
    { index: -2147483648, expected: ['zero', 'one', 'two', 'three'] },
  ])('deletes index $index at runtime without SQL params', async (testCase) => {
    const result = await executeQuery(
      db,
      jsonArrayDelete(source, testCase.index),
    )

    expect(result).toEqual(testCase.expected)
  })

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    2147483648,
    -2147483649,
    Number.MAX_SAFE_INTEGER,
    Number.MIN_SAFE_INTEGER,
    1.2,
    -1.2,
  ])('lets PostgreSQL reject invalid numeric index %s', async (index) => {
    await expect(
      executeQuery(db, jsonArrayDelete(source, index as any)),
    ).rejects.toThrow()
  })

  it('keeps string index misuse as PostgreSQL text-delete semantics', async () => {
    const hostileIndex = "0'); drop table array_delete_sentinel; --"
    const query = dialect.sqlToQuery(
      jsonArrayDelete(source, hostileIndex as any),
    )

    expect(query.sql).toBe(
      `coalesce(nullif(${sourceSql}, 'null'::jsonb), '[]'::jsonb) - '0''); drop table array_delete_sentinel; --'`,
    )
    expect(query.params).toEqual([])
    await expect(
      executeQuery(db, jsonArrayDelete(source, hostileIndex as any)),
    ).resolves.toEqual(['zero', 'one', 'two', 'three'])
  })

  it('preserves parameterized source SQL params and deletes by index', async () => {
    const payload = "source'); drop table array_delete_sentinel; --"
    const sourceParam = JSON.stringify(['keep', payload])
    const parameterizedSource = sql<string[]>`${sourceParam}::jsonb`
    const query = dialect.sqlToQuery(jsonArrayDelete(parameterizedSource, 1))

    expect(query.sql).toBe(
      `coalesce(nullif($1::jsonb, 'null'::jsonb), '[]'::jsonb) - 1`,
    )
    expect(query.params).toEqual([sourceParam])
    expect(query.sql).not.toContain(payload)
    await expect(
      executeQuery(db, jsonArrayDelete(parameterizedSource, 1)),
    ).resolves.toEqual(['keep'])
  })

  it('keeps SQLWrapper source expressions caller-controlled while preserving params', () => {
    const payload = "wrapped'); select 1; --"
    const wrapperSource = sql<string[]>`'["keep"]'::jsonb || ${JSON.stringify([
      payload,
    ])}::jsonb`
    const query = dialect.sqlToQuery(jsonArrayDelete(wrapperSource, 1))

    expect(query.sql).toBe(
      `coalesce(nullif('["keep"]'::jsonb || $1::jsonb, 'null'::jsonb), '[]'::jsonb) - 1`,
    )
    expect(query.params).toEqual([JSON.stringify([payload])])
    expect(query.sql).not.toContain(payload)
  })

  it('public arrayDelete alias generates the same SQL and params as jsonArrayDelete', () => {
    const directQuery = dialect.sqlToQuery(jsonArrayDelete(source, -1))
    const aliasQuery = dialect.sqlToQuery(arrayDelete(source, -1))

    expect(aliasQuery).toEqual(directQuery)
  })
})
