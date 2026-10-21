import { type SQL, sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'

import { json } from '../../src/index.ts'
import { jsonArraySet } from '../../src/json/operations/array.ts'
import { jsonSet } from '../../src/json/operations/set.ts'
import { createDatabase, executeQuery, type TestDatabase } from '../utils.ts'

let db: TestDatabase

beforeAll(async () => {
  db = await createDatabase()
})

// `jsonb_set` is strict: a SQL NULL new value nulls the whole document. Each
// helper must confine a NULL-yielding SQL value to the target path.
describe('SQL NULL values in JSON writes', () => {
  type Doc = {
    keep: string
    target: string | null
    optional?: { nested: string | null }
    items: Array<string | null>
  }

  const doc = sql<Doc>`'{"keep":"yes","target":"old","items":["a","b"]}'::jsonb`
  // A scalar subquery with no rows is the realistic way to get SQL NULL.
  const noRow = sql<string>`(select 'x'::text where false)`
  const nullJsonb = sql<string>`NULL::jsonb`

  it.each([
    ['computed expression', noRow],
    ['SQL NULL literal', nullJsonb],
    ['bare null param', sql<string>`${null}`],
  ])('ref $set with %s writes JSON null at the path', async (_, value) => {
    await expect(
      executeQuery(db, json(doc).target.$set(value as SQL<string>)),
    ).resolves.toEqual({ keep: 'yes', target: null, items: ['a', 'b'] })
  })

  it('jsonSet $set keeps the document when the value is SQL NULL', async () => {
    await expect(
      executeQuery(db, jsonSet(doc).target.$set(noRow)),
    ).resolves.toEqual({ keep: 'yes', target: null, items: ['a', 'b'] })
  })

  it('ref $default keeps the document when the default is SQL NULL', async () => {
    const result = json(doc).optional.$default(sql`NULL::jsonb`)

    await expect(executeQuery(db, result)).resolves.toEqual({
      keep: 'yes',
      target: 'old',
      optional: null,
      items: ['a', 'b'],
    })
  })

  it('jsonSet $default keeps the document when the default is SQL NULL', async () => {
    const result = jsonSet(doc)
      .optional.$default(sql`NULL::jsonb`)
      .nested.$set('value')

    await expect(executeQuery(db, result)).resolves.toMatchObject({
      keep: 'yes',
      optional: null,
    })
  })

  it('arraySet keeps the array when the value is SQL NULL', async () => {
    await expect(
      executeQuery(
        db,
        jsonArraySet(sql<string[]>`'["a","b"]'::jsonb`, 0, noRow),
      ),
    ).resolves.toEqual([null, 'b'])
  })

  it('ref array element $set keeps the document when the value is SQL NULL', async () => {
    await expect(
      executeQuery(db, json(doc).items[1].$set(noRow)),
    ).resolves.toEqual({ keep: 'yes', target: 'old', items: ['a', null] })
  })

  it('still writes non-null SQL values unchanged', async () => {
    await expect(
      executeQuery(db, json(doc).target.$set(sql<string>`upper('new')`)),
    ).resolves.toEqual({ keep: 'yes', target: 'NEW', items: ['a', 'b'] })
  })
})
