import { sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { arraySet } from '../../src/json/index.ts'
import { jsonArraySet } from '../../src/json/operations/array.ts'
import { jsonBuild } from '../../src/json/operations/build.ts'
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

const arraySql = `'["a", "b"]'::jsonb`
const baseArray = sql<any[]>`${sql.raw(arraySql)}`

const jsonParam = (value: unknown) => JSON.stringify(value)

const sqlString = (value: string) => `'${value.replaceAll("'", "''")}'`

const stripSqlStringLiterals = (query: string) => {
  let stripped = ''

  for (let i = 0; i < query.length; i++) {
    if (query[i] !== "'") {
      stripped += query[i]
      continue
    }

    i++
    while (i < query.length) {
      if (query[i] === "'" && query[i + 1] === "'") {
        i += 2
        continue
      }
      if (query[i] === "'") break
      i++
    }

    stripped += "''"
  }

  return stripped
}

const expectNoExecutableInjection = (query: string) => {
  const structuralSql = stripSqlStringLiterals(query).toLowerCase()

  expect(structuralSql).not.toContain('drop table')
  expect(structuralSql).not.toContain('pg_sleep')
  expect(structuralSql).not.toContain('select 1')
}

describe('jsonArraySet SQL injection hardening', () => {
  const maliciousValue = "x'); select pg_sleep(1); --"
  const maliciousObjectKey = "k'); drop table users; --"
  const maliciousObjectValue = "v'); select 1; --"

  it('keeps malicious plain string values parameterized', async () => {
    const result = jsonArraySet(baseArray, 0, maliciousValue)
    const query = dialect.sqlToQuery(result)

    expect(query.sql).toBe(
      `jsonb_set(coalesce(nullif(${arraySql}, 'null'::jsonb), '[]'::jsonb), '{0}', $1::jsonb, false)`,
    )
    expect(query.sql).not.toContain(maliciousValue)
    expect(query.params).toEqual([jsonParam(maliciousValue)])
    expectNoExecutableInjection(query.sql)
    await expect(executeQuery(db, result)).resolves.toEqual([
      maliciousValue,
      'b',
    ])
  })

  it('keeps malicious plain object keys and values inside one JSON param', async () => {
    const value = {
      [maliciousObjectKey]: maliciousObjectValue,
      safe: 'ok',
    }
    const result = jsonArraySet(baseArray, 0, value)
    const query = dialect.sqlToQuery(result)

    expect(query.sql).toBe(
      `jsonb_set(coalesce(nullif(${arraySql}, 'null'::jsonb), '[]'::jsonb), '{0}', $1::jsonb, false)`,
    )
    expect(query.sql).not.toContain(maliciousObjectKey)
    expect(query.sql).not.toContain(maliciousObjectValue)
    expect(query.params).toEqual([jsonParam(value)])
    expectNoExecutableInjection(query.sql)
    await expect(executeQuery(db, result)).resolves.toEqual([value, 'b'])
  })

  it('escapes malicious jsonBuild object keys and parameterizes values', async () => {
    const value = jsonBuild({
      [maliciousObjectKey]: maliciousObjectValue,
      skip: undefined,
    } as any)
    const result = jsonArraySet(baseArray, 0, value)
    const query = dialect.sqlToQuery(result)

    expect(query.sql).toBe(
      `jsonb_set(coalesce(nullif(${arraySql}, 'null'::jsonb), '[]'::jsonb), '{0}', to_jsonb(jsonb_build_object(${sqlString(maliciousObjectKey)}, $1::jsonb)), false)`,
    )
    expect(query.sql).not.toContain('skip')
    expect(query.sql).not.toContain(maliciousObjectValue)
    expect(query.params).toEqual([jsonParam(maliciousObjectValue)])
    expectNoExecutableInjection(query.sql)
    await expect(executeQuery(db, result)).resolves.toEqual([
      { [maliciousObjectKey]: maliciousObjectValue },
      'b',
    ])
  })

  it('maps undefined and null values to JSON null params', async () => {
    const undefinedResult = jsonArraySet(baseArray, 0, undefined as any)
    const nullResult = jsonArraySet(baseArray, 1, null as any)
    const undefinedQuery = dialect.sqlToQuery(undefinedResult)
    const nullQuery = dialect.sqlToQuery(nullResult)

    expect(undefinedQuery.sql).toBe(
      `jsonb_set(coalesce(nullif(${arraySql}, 'null'::jsonb), '[]'::jsonb), '{0}', $1::jsonb, false)`,
    )
    expect(nullQuery.sql).toBe(
      `jsonb_set(coalesce(nullif(${arraySql}, 'null'::jsonb), '[]'::jsonb), '{1}', $1::jsonb, false)`,
    )
    expect(undefinedQuery.params).toEqual(['null'])
    expect(nullQuery.params).toEqual(['null'])
    await expect(executeQuery(db, undefinedResult)).resolves.toEqual([
      null,
      'b',
    ])
    await expect(executeQuery(db, nullResult)).resolves.toEqual(['a', null])
  })

  it('keeps bare SQLWrapper params parameterized', () => {
    const result = jsonArraySet(baseArray, 0, sql`${maliciousValue}`)
    const query = dialect.sqlToQuery(result)

    expect(query.sql).toBe(
      `jsonb_set(coalesce(nullif(${arraySql}, 'null'::jsonb), '[]'::jsonb), '{0}', $1, false)`,
    )
    expect(query.sql).not.toContain(maliciousValue)
    expect(query.params).toEqual([maliciousValue])
    expectNoExecutableInjection(query.sql)
  })

  it('embeds computed SQLWrapper values as intentional SQL with params', async () => {
    const result = jsonArraySet(baseArray, 0, sql`lower(${maliciousValue})`)
    const query = dialect.sqlToQuery(result)

    expect(query.sql).toBe(
      `jsonb_set(coalesce(nullif(${arraySql}, 'null'::jsonb), '[]'::jsonb), '{0}', to_jsonb(lower($1)), false)`,
    )
    expect(query.sql).not.toContain(maliciousValue)
    expect(query.params).toEqual([maliciousValue])
    expectNoExecutableInjection(query.sql)
    await expect(executeQuery(db, result)).resolves.toEqual([
      maliciousValue.toLowerCase(),
      'b',
    ])
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
  ])('lets PostgreSQL reject invalid index %s', async (index) => {
    await expect(
      executeQuery(db, jsonArraySet(baseArray, index as any, 'safe')),
    ).rejects.toThrow()
  })

  it('applies same value escaping through public arraySet alias', async () => {
    const result = arraySet(baseArray, 1, maliciousValue)
    const query = dialect.sqlToQuery(result)

    expect(query.sql).toBe(
      `jsonb_set(coalesce(nullif(${arraySql}, 'null'::jsonb), '[]'::jsonb), '{1}', $1::jsonb, false)`,
    )
    expect(query.sql).not.toContain(maliciousValue)
    expect(query.params).toEqual([jsonParam(maliciousValue)])
    expectNoExecutableInjection(query.sql)
    await expect(executeQuery(db, result)).resolves.toEqual([
      'a',
      maliciousValue,
    ])
  })
})
