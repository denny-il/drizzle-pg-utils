import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { jsonBuild } from '../../src/json/operations/build.ts'
import { dialect } from '../utils.ts'

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

  it('cast JS text to jsonb', () => {
    const value = 'hello'
    const result = jsonBuild(value)
    const query = dialect.sqlToQuery(result)

    expect(query.params).toEqual([JSON.stringify('hello')])
    expect(query.sql).toBe(`$1::jsonb`)
  })
})
