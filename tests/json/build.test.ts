import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { jsonBuild } from '../../src/json/operations/build.ts'
import { dialect, table } from '../utils.ts'

describe('JSON Build', () => {
  it('casts SQL primitives to jsonb', () => {
    const value = sql<number>`${42}`
    const result = jsonBuild(value)
    const query = dialect.sqlToQuery(result)

    expect(query.params).toEqual([42])
    expect(query.sql).toBe(`$1`)
  })

  it('casts SQL text to jsonb', () => {
    const value = sql<string>`${'hello'}`
    const result = jsonBuild(value)
    const query = dialect.sqlToQuery(result)

    expect(query.params).toEqual(['hello'])
    expect(query.sql).toBe(`$1`)
  })

  it('converts single nested SQL expressions to jsonb', () => {
    const result = jsonBuild(sql.join([sql`42::integer`]))
    const query = dialect.sqlToQuery(result)

    expect(query.sql).toBe(`to_jsonb(42::integer)`)
  })

  it('cast JS text to jsonb', () => {
    const value = 'hello'
    const result = jsonBuild(value)
    const query = dialect.sqlToQuery(result)

    expect(query.params).toEqual([JSON.stringify('hello')])
    expect(query.sql).toBe(`$1::text::jsonb`)
  })

  it('accepts column SQL wrappers inside objects', () => {
    const result = jsonBuild({ columnValue: table.jsoncol })

    expect(result).toBeDefined()
  })
})
