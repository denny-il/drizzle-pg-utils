import { type SQL, sql } from 'drizzle-orm'
import { integer, pgTable, timestamp } from 'drizzle-orm/pg-core'
import { describe, expect, expectTypeOf, it } from 'vitest'

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

    expect(dialect.sqlToQuery(result).sql).toBe(
      `jsonb_build_object('columnValue', to_jsonb("test"."jsoncol"))`,
    )
    expectTypeOf(result).toEqualTypeOf<SQL<{ columnValue: { some: 'json' } }>>()
  })

  it('accepts untyped SQL snippets', () => {
    const result = jsonBuild({ at: sql`now()::text`, source: 'api' })

    expectTypeOf(result).toEqualTypeOf<SQL<{ at: unknown; source: string }>>()
  })

  it('types columns by their to_jsonb output', () => {
    const other = pgTable('other', {
      n: integer('n'),
      at: timestamp('at').notNull(),
    })
    const result = jsonBuild({
      nullableJson: table.jsoncolNullable,
      n: other.n,
      at: other.at,
    })

    // `at` decodes to a `Date` in drizzle but is a string in the built JSON.
    expectTypeOf(result).toEqualTypeOf<
      SQL<{
        nullableJson: { some: 'json' } | null
        n: number | null
        at: string
      }>
    >()
  })
})
