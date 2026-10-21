import { type SQL, sql } from 'drizzle-orm'
import { integer, pgTable, timestamp } from 'drizzle-orm/pg-core'
import { Temporal } from 'temporal-polyfill'
import { describe, expect, expectTypeOf, it } from 'vitest'

import { json } from '../../src/index.ts'
import { jsonBuild } from '../../src/json/operations/build.ts'
import {
  closeDatabase,
  createDatabase,
  dialect,
  executeQuery,
  table,
} from '../utils.ts'

describe('JSON Build', () => {
  it('encodes bare SQL numbers as JSON params', () => {
    const value = sql<number>`${42}`
    const result = jsonBuild(value)
    const query = dialect.sqlToQuery(result)

    expect(query.params).toEqual(['42'])
    expect(query.sql).toBe(`$1::text::jsonb`)
  })

  it('encodes bare SQL text as JSON params', () => {
    const value = sql<string>`${'hello'}`
    const result = jsonBuild(value)
    const query = dialect.sqlToQuery(result)

    expect(query.params).toEqual([JSON.stringify('hello')])
    expect(query.sql).toBe(`$1::text::jsonb`)
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

  describe('values with toJSON', () => {
    const date = new Date('2024-01-02T03:04:05.000Z')
    const plainDate = Temporal.PlainDate.from('2024-01-02')

    it('serializes like JSON.stringify instead of as empty objects', async () => {
      const db = await createDatabase()
      const value = {
        date,
        plainDate,
        nested: [date, { plainDate }],
      }

      try {
        await expect(
          executeQuery(db, jsonBuild(value as any)),
        ).resolves.toEqual(JSON.parse(JSON.stringify(value)))
        // Root and nested writes go through jsonBuild, unlike array pushes
        // which already used JSON.stringify; both must agree.
        await expect(
          executeQuery(
            db,
            json(
              sql<{ at?: unknown; list: unknown[] }>`'{"list":[]}'::jsonb`,
            ).$pipe(
              (doc) => doc.at.$set({ date } as any),
              (doc) => doc.list.$push(date),
            ),
          ),
        ).resolves.toEqual({
          at: { date: date.toJSON() },
          list: [date.toJSON()],
        })
      } finally {
        await closeDatabase(db)
      }
    }, 15_000)

    it('calls toJSON once per position like JSON.stringify', async () => {
      class Self {
        value = 1
        child = { date }
        toJSON() {
          return this
        }
      }
      const value = { self: new Self() }
      const db = await createDatabase()

      try {
        await expect(
          executeQuery(db, jsonBuild(value as any)),
        ).resolves.toEqual(JSON.parse(JSON.stringify(value)))
      } finally {
        await closeDatabase(db)
      }
    }, 15_000)

    it('applies JSON.stringify key and omission rules', async () => {
      class Hidden {
        toJSON() {
          return undefined
        }
      }
      const value = {
        keep: 1,
        hidden: new Hidden(),
        fn: () => 1,
        list: [new Hidden(), () => 1, 'x'],
        keyed: { toJSON: (key: string) => `key:${key}` },
        literal: {
          value: 1,
          toJSON() {
            return this
          },
        },
      }
      const db = await createDatabase()

      try {
        await expect(
          executeQuery(db, jsonBuild(value as any)),
        ).resolves.toEqual(JSON.parse(JSON.stringify(value)))
        // JSON.stringify returns undefined for a root it omits; JSON null is
        // the closest JSONB value.
        await expect(
          executeQuery(db, jsonBuild(new Hidden() as any)),
        ).resolves.toBeNull()
      } finally {
        await closeDatabase(db)
      }
    }, 15_000)

    it('binds the toJSON result as a parameter', () => {
      const query = dialect.sqlToQuery(jsonBuild({ date } as any))

      expect(query.sql).toBe(`jsonb_build_object('date', $1::text::jsonb)`)
      expect(query.params).toEqual([JSON.stringify(date)])
    })
  })
})
