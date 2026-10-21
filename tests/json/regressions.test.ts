import { type SQL, sql } from 'drizzle-orm'
import {
  bigint,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'
import { beforeAll, describe, expect, expectTypeOf, it } from 'vitest'

import { json } from '../../src/json/index.ts'
import { plainDate } from '../../src/temporal/polyfill.ts'
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

describe('JSON regression cases', () => {
  it.each(['hello', '42', '', 42, true, null])(
    'builds a bare SQL parameter as JSON data: %j',
    async (value) => {
      const built = json.build({ value: sql<typeof value>`${value}` })
      expect(await executeQuery(db, built)).toEqual({ value })
    },
  )

  it('builds an undefined parameter as JSON null', async () => {
    const built = json.build(sql.param(undefined))
    const query = dialect.sqlToQuery(built)
    expect(query.sql).toBe('$1::text::jsonb')
    expect(query.params).toEqual(['null'])
    // jsonb_typeof distinguishes JSON null from SQL NULL.
    expect(await executeQuery(db, sql`jsonb_typeof(${built})`)).toBe('null')
  })

  it('builds sparse arrays with JSON null holes', async () => {
    // A real hole exercises iteration behavior that explicit undefined does not.
    // oxlint-disable-next-line unicorn/no-new-array
    const values: (number | undefined)[] = new Array(3)
    values[0] = 1
    values[2] = 3
    expect(
      await executeQuery(db, json.build(values as (number | null)[])),
    ).toEqual([1, null, 3])
  })

  it('builds explicit Drizzle params and nested single-parameter SQL', async () => {
    expect(
      await executeQuery(
        db,
        json.build({
          explicit: sql<string>`${sql.param('42')}`,
          nested: sql.join([sql<string>`${'hello'}`]),
        }),
      ),
    ).toEqual({ explicit: '42', nested: 'hello' })
  })

  it('encodes bare prepared placeholders when the value is bound', async () => {
    const query = db
      .select({ doc: json.build({ value: sql`${sql.placeholder('value')}` }) })
      .from(sql`(values (1)) as seed(id)`)
      .prepare('json_placeholder')
    expect(await query.execute({ value: '42' })).toEqual([
      { doc: { value: '42' } },
    ])
    expect(await query.execute({ value: { nested: true } })).toEqual([
      { doc: { value: { nested: true } } },
    ])
    expect(await query.execute({ value: null })).toEqual([
      { doc: { value: null } },
    ])
  })

  it('evaluates volatile sources once across legacy defaults', async () => {
    await db.execute(sql`create sequence json_default_evaluations`)
    const source = sql<{
      stamp: number
      config?: { count: number }
    }>`jsonb_build_object('stamp', nextval('json_default_evaluations'), 'config', '{"count":1}'::jsonb)`
    expect(
      await executeQuery(
        db,
        json.set(source).config.$default({ count: 0 }).count.$set(2),
      ),
    ).toEqual({ stamp: 1, config: { count: 2 } })
    expect(
      await executeQuery(
        db,
        sql`(select last_value::int from json_default_evaluations)`,
      ),
    ).toBe(1)
  })

  it('pushes bare SQL params through the standalone and ref helpers', async () => {
    expect(
      await executeQuery(
        db,
        json.arrayPush(sql<string[]>`'[]'::jsonb`, sql<string>`${'42'}`),
      ),
    ).toEqual(['42'])
    const source = sql<{ items: string[] }>`'{"items":[]}'::jsonb`
    expect(
      await executeQuery(db, json(source).items.$push(sql<string>`${'hello'}`)),
    ).toEqual({ items: ['hello'] })
  })

  it('inlines expression aliases while preserving real subquery references', async () => {
    expect(
      await executeQuery(
        db,
        json.build({ value: sql<number>`42::integer`.as('unused') }),
      ),
    ).toEqual({ value: 42 })
    const wrapped = sql<number>`42::integer`.as('unused')
    expect(
      await executeQuery(
        db,
        json.build({
          bare: sql<number>`${wrapped}`,
          joined: sql.join([wrapped]),
        }),
      ),
    ).toEqual({ bare: 42, joined: 42 })
    const aliased = sql<{ value: string }>`'{"value":"kept"}'::jsonb`.as(
      'unused_doc',
    )
    expect(await executeQuery(db, json(aliased).value.$text)).toBe('kept')
    const subquery = db
      .select({ doc: aliased })
      .from(sql`(values (1)) as seed(id)`)
      .as('docs')
    const [row] = await db
      .select({
        value: json(subquery.doc).value.$text,
        copy: json.build({ doc: subquery.doc }),
      })
      .from(subquery)
    expect(row).toEqual({ value: 'kept', copy: { doc: { value: 'kept' } } })
  })

  it('respects explicit parameter encoders without double-encoding JSON', async () => {
    const table = pgTable('json_param_types', {
      doc: jsonb().$type<{ value: number }>(),
    })
    const encoded = sql<string>`${sql.param('hello', { mapToDriverValue: (value: string) => value.toUpperCase() })}`
    const doc = sql<{
      value: number
    }>`${sql.param<{ value: number }, unknown>({ value: 1 }, table.doc)}`
    expect(await executeQuery(db, json.build({ encoded, doc }))).toEqual({
      encoded: 'HELLO',
      doc: { value: 1 },
    })
  })

  it('bypasses column encoders for SQL-valued parameters', async () => {
    const table = pgTable('json_sql_param', { at: timestamp() })
    const expression = sql`${sql.param<Date | string | SQL, string>(sql`timestamp '2026-10-22 12:00:00'`, table.at)}`
    expect(await executeQuery(db, json.build({ at: expression }))).toEqual({
      at: '2026-10-22T12:00:00',
    })
  })

  it('infers JSON representations of decoded database column types', async () => {
    const table = pgTable('json_column_outputs', {
      at: timestamp().notNull(),
      count: bigint({ mode: 'bigint' }).notNull(),
      amount: numeric().notNull(),
      date: plainDate.column().notNull(),
      times: timestamp().array().notNull(),
    })
    await db.execute(
      sql`create table json_column_outputs (at timestamp not null, count bigint not null, amount numeric not null, date date not null, times timestamp[] not null)`,
    )
    await db.insert(table).values({
      at: new Date('2026-10-22T12:00:00Z'),
      count: 42n,
      amount: '12.5',
      date: sql`date '2026-10-22'`,
      times: [new Date('2026-10-22T12:00:00Z')],
    })
    const built = json.build({
      at: table.at,
      count: table.count,
      amount: table.amount,
      date: table.date,
      times: table.times,
    })
    expectTypeOf(built).toEqualTypeOf<
      SQL<{
        at: string
        count: number
        amount: number
        date: unknown
        times: string[]
      }>
    >()
    const [row] = await db.select({ doc: built }).from(table)
    expect(row!.doc).toEqual({
      at: '2026-10-22T12:00:00',
      count: 42,
      amount: 12.5,
      date: '2026-10-22',
      times: ['2026-10-22T12:00:00'],
    })
  })

  it('sets a bare SQL string without parsing it as JSON', async () => {
    const source = sql<{ value: string }>`'{"value":"old"}'::jsonb`
    expect(
      await executeQuery(db, json(source).value.$set(sql<string>`${'42'}`)),
    ).toEqual({ value: '42' })
    expect(
      await executeQuery(
        db,
        json.arraySet(
          sql<string[]>`'["old"]'::jsonb`,
          0,
          sql<string>`${'hello'}`,
        ),
      ),
    ).toEqual(['hello'])
  })

  it('uses an empty string as an exact legacy set path', async () => {
    const source = sql<{
      '': { value: number }
      keep: boolean
    }>`'{"":{"value":1},"keep":true}'::jsonb`
    expect(await executeQuery(db, json.set(source)[''].value.$set(2))).toEqual({
      '': { value: 2 },
      keep: true,
    })
  })

  it('groups a computed containment value', async () => {
    const source = sql<{ a: number; b: number }>`'{"a":1,"b":2}'::jsonb`
    const value = sql<{
      a: number
      b: number
    }>`'{"a":1}'::jsonb || '{"b":2}'::jsonb`
    expect(await executeQuery(db, json.contains(source, value))).toBe(true)
    expect(await executeQuery(db, json(source).$contains(value))).toBe(true)
  })

  it('infers nullable columns and SQL wrappers inside builders', () => {
    const table = pgTable('json_type_regressions', {
      doc: jsonb().$type<{ value: string }>(),
      label: text().notNull(),
    })
    const defaultRef = json(
      sql<{ config?: { count: number } }>`'{}'::jsonb`,
    ).config.$default({ count: 1 })
    expectTypeOf(defaultRef.getSQL()).toEqualTypeOf<
      SQL<{ config?: { count: number } }>
    >()
    expectTypeOf(json.build({ label: table.label })).toEqualTypeOf<
      SQL<{ label: string }>
    >()
    expectTypeOf(json.build({ doc: table.doc })).toEqualTypeOf<
      SQL<{ doc: { value: string } | null }>
    >()
    expectTypeOf(json.coalesce(table.doc, { value: 'fallback' })).toMatchTypeOf<
      SQL<{ value: string }>
    >()
  })
})
