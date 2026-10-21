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
import { createDatabase, type TestDatabase } from '../utils.ts'

let db: TestDatabase
beforeAll(async () => {
  db = await createDatabase()
})

describe('JSON regression cases', () => {
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
