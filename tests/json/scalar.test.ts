import { randomUUID } from 'node:crypto'

import { asc, eq, lt, type SQL, sql } from 'drizzle-orm'
import { integer, jsonb, pgTable } from 'drizzle-orm/pg-core'
import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from 'vitest'

import { json } from '../../src/index.ts'
import {
  closeDatabase,
  createDatabase,
  dialect,
  executeQuery,
  type TestDatabase,
} from '../utils.ts'

type Doc = {
  score: number
  ratio?: number
  enabled: boolean
  label: string
  either: string | number
  nested: { count: number | null }
}

describe('JSON ref scalar accessors', () => {
  const doc = json(sql<Doc>`doc`)

  it('casts the extracted value, mapping JSON null to SQL NULL first', () => {
    expect(dialect.sqlToQuery(doc.score.$number)).toEqual({
      sql: `nullif(jsonb_extract_path(doc, 'score'), 'null'::jsonb)::float8`,
      params: [],
    })
    expect(dialect.sqlToQuery(doc.enabled.$boolean)).toEqual({
      sql: `nullif(jsonb_extract_path(doc, 'enabled'), 'null'::jsonb)::boolean`,
      params: [],
    })
    expect(dialect.sqlToQuery(json(sql<number>`n`).$number)).toEqual({
      sql: `nullif(n, 'null'::jsonb)::float8`,
      params: [],
    })
  })

  it('offers each accessor only where the JSON type matches', () => {
    const columns = pgTable('scalar_docs', {
      doc: jsonb('doc').$type<Doc>().notNull(),
      maybe: jsonb('maybe').$type<Doc>(),
    })

    expectTypeOf(doc.score.$number).toEqualTypeOf<SQL<number>>()
    expectTypeOf(doc.ratio.$number).toEqualTypeOf<SQL<number | null>>()
    expectTypeOf(doc.nested.count.$number).toEqualTypeOf<SQL<number | null>>()
    expectTypeOf(doc.enabled.$boolean).toEqualTypeOf<SQL<boolean>>()
    expectTypeOf(json(columns.doc).score.$number).toEqualTypeOf<SQL<number>>()
    expectTypeOf(json(columns.maybe).score.$number).toEqualTypeOf<
      SQL<number | null>
    >()
    expectTypeOf(json(sql<unknown>`doc`).$key('n').$number).toEqualTypeOf<
      SQL<number | null>
    >()
    expectTypeOf(doc.label).not.toHaveProperty('$number')
    expectTypeOf(doc.either).not.toHaveProperty('$number')
    expectTypeOf(doc.score).not.toHaveProperty('$boolean')
    expectTypeOf(doc.enabled).not.toHaveProperty('$number')
    expectTypeOf(doc.nested).not.toHaveProperty('$number')
  })

  describe('evaluation', () => {
    let db: TestDatabase
    const run = (expression: SQL) => executeQuery(db, expression)
    const value = (literal: string) => json(sql<Doc>`${literal}::text::jsonb`)

    beforeAll(async () => {
      db = await createDatabase()
    })

    afterAll(async () => {
      await closeDatabase(db)
    })

    it('decodes numbers and booleans as JS values on every driver', async () => {
      const source = value(
        '{"score":2.5,"ratio":0,"enabled":false,"nested":{"count":-3}}',
      )

      expect(await run(source.score.$number)).toBe(2.5)
      expect(await run(source.ratio.$number)).toBe(0)
      expect(await run(source.nested.count.$number)).toBe(-3)
      expect(await run(source.enabled.$boolean)).toBe(false)
      expect(await run(value('{"enabled":true}').enabled.$boolean)).toBe(true)
    })

    it('returns SQL NULL for missing keys, JSON null, and a SQL NULL source', async () => {
      expect(await run(value('{}').score.$number)).toBeNull()
      expect(await run(value('{"score":null}').score.$number)).toBeNull()
      expect(await run(value('{"enabled":null}').enabled.$boolean)).toBeNull()
      expect(await run(json(sql<Doc>`null::jsonb`).score.$number)).toBeNull()
      expect(await run(json(sql<number>`'null'::jsonb`).$number)).toBeNull()
    })

    it('errors on a value of another JSON type instead of guessing', async () => {
      await expect(
        run(value('{"score":"2.5"}').score.$number),
      ).rejects.toThrow()
      await expect(run(value('{"score":{}}').score.$number)).rejects.toThrow()
      await expect(
        run(value('{"enabled":"true"}').enabled.$boolean),
      ).rejects.toThrow()
    })

    it('compares and orders numerically inside drizzle queries', async () => {
      const tableName = `json_scalar_${randomUUID().replaceAll('-', '').slice(0, 8)}`
      const items = pgTable(tableName, {
        id: integer('id').notNull(),
        doc: jsonb('doc').$type<Doc>().notNull(),
      })
      const item = (id: number, score: number, label: string): Doc => ({
        score,
        enabled: score > 5,
        label,
        either: label,
        nested: { count: null },
      })

      await db.execute(
        sql`create table ${items} (id integer not null, doc jsonb not null)`,
      )
      try {
        await db.insert(items).values([
          { id: 1, doc: item(1, 10, 'dark') },
          { id: 2, doc: item(2, 9, 'light') },
          { id: 3, doc: item(3, 2.5, 'dark') },
        ])

        const score = json(items.doc).score.$number
        const rows = await db
          .select({
            id: items.id,
            score,
            enabled: json(items.doc).enabled.$boolean,
          })
          .from(items)
          .where(lt(score, 9.5))
          .orderBy(asc(score))

        expectTypeOf(rows).toEqualTypeOf<
          Array<{ id: number; score: number; enabled: boolean }>
        >()
        // Text ordering would put "10" before "2.5" and "9".
        expect(rows).toEqual([
          { id: 3, score: 2.5, enabled: false },
          { id: 2, score: 9, enabled: true },
        ])

        // String comparisons go through $text, or a JSON-encoded value.
        const darkByText = await db
          .select({ id: items.id })
          .from(items)
          .where(eq(json(items.doc).label.$text, 'dark'))
          .orderBy(asc(items.id))
        const darkByValue = await db
          .select({ id: items.id })
          .from(items)
          .where(eq(json(items.doc).label.$value, json.build('dark')))
          .orderBy(asc(items.id))

        expect(darkByText).toEqual([{ id: 1 }, { id: 3 }])
        expect(darkByValue).toEqual([{ id: 1 }, { id: 3 }])
      } finally {
        await db.execute(sql`drop table ${items}`)
      }
    })
  })
})

describe('JSON ref $key typing', () => {
  type Audit = { score: number | null; title: string }
  type Report = {
    audits: Record<string, Audit>
    named: { first: Audit; optional?: Audit }
    list: Audit[]
  }
  const report = json(sql<Report>`report`)

  it('keeps the value type for Record and declared keys', () => {
    expectTypeOf(report.audits.$key('fcp').score.$value).toEqualTypeOf<
      SQL<number | null>
    >()
    expectTypeOf(report.audits.$key('fcp').$value).toEqualTypeOf<SQL<Audit>>()
    expectTypeOf(report.named.$key('first').title.$text).toEqualTypeOf<
      SQL<string>
    >()
    expectTypeOf(report.named.$key('optional').title.$text).toEqualTypeOf<
      SQL<string | null>
    >()
    expectTypeOf(
      report.audits.$key('fcp').$set({ score: 1, title: 't' }),
    ).toEqualTypeOf<SQL<Report>>()
  })

  it('stays unknown for undeclared keys and array refs', () => {
    expectTypeOf(report.named.$key('missing').$value).toEqualTypeOf<
      SQL<unknown>
    >()
    expectTypeOf(report.list.$key('length').$value).toEqualTypeOf<
      SQL<unknown>
    >()
  })

  it('emits the same SQL as property access', () => {
    expect(dialect.sqlToQuery(report.audits.$key('fcp').score.$value)).toEqual(
      dialect.sqlToQuery(report.audits.fcp!.score.$value),
    )
  })

  it('rejects writes the declared value type does not allow', () => {
    // Never called: `pnpm check:type` verifies the expected errors.
    const _expectTypeErrors = () => {
      // @ts-expect-error Record values are not declared nullable.
      report.audits.$key('fcp').$set(null)
      // @ts-expect-error the value keeps its declared shape.
      report.audits.$key('fcp').$set({ score: 'high', title: 't' })
    }
  })
})
