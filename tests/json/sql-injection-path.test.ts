import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { json } from '../../src/index.ts'
import {
  closeDatabase,
  createDatabase,
  dialect,
  executeQuery,
  type TestDatabase,
} from '../utils.ts'

let db: TestDatabase

beforeAll(async () => {
  db = await createDatabase()
})

afterAll(async () => {
  await closeDatabase(db)
})

// Each payload tries to close the SQL string, the jsonpath string, or the
// jsonpath filter, and to smuggle in a match-everything condition.
const payloads = [
  `x'); drop table path_sentinel; --`,
  `x" || @ == @ || "`,
  `x") || exists(@) || ("`,
  `x\\" || true || \\"`,
  `$.** ? (@ == @)`,
  'line\nbreak separator',
]

type Doc = {
  s: string
  items: Array<{ name: string }>
  map: Record<string, string>
}

const docSql = (value: Doc) => sql<Doc>`${JSON.stringify(value)}::text::jsonb`

describe('JSON path SQL injection and misuse resistance', () => {
  it.each(payloads)(
    'keeps the comparison value %j inside one jsonpath string',
    async (payload) => {
      const source = json(docSql({ s: 'safe', items: [], map: {} })).$path
      const predicate = source.$filter((d) => d.s.$eq(payload)).$exists
      const query = dialect.sqlToQuery(predicate)

      expect(query.sql).toBe(`$1::text::jsonb @? $2::text::jsonpath`)
      expect(query.sql).not.toContain(payload)
      expect(query.params[1]).toBe(`$ ? (@."s" == ${JSON.stringify(payload)})`)
      await expect(executeQuery(db, predicate)).resolves.toBe(false)

      const matching = json(docSql({ s: payload, items: [], map: {} })).$path
      await expect(
        executeQuery(db, matching.$filter((d) => d.s.$eq(payload)).$exists),
      ).resolves.toBe(true)
    },
  )

  it.each(payloads)(
    'keeps the key %j inside one quoted jsonpath key',
    async (payload) => {
      const source = json(
        docSql({
          s: 'safe',
          items: [],
          map: { [payload]: 'hit', other: 'miss' },
        }),
      ).$path
      const lookup = source.map.$key(payload).$query
      const query = dialect.sqlToQuery(lookup)

      expect(query.sql).toBe(
        `jsonb_path_query_array($1::text::jsonb, $2::text::jsonpath)`,
      )
      expect(query.params[1]).toBe(`$."map".${JSON.stringify(payload)}`)
      await expect(executeQuery(db, lookup)).resolves.toEqual(['hit'])
      await expect(
        executeQuery(db, source.map.$key(`${payload}!`).$query),
      ).resolves.toEqual([])
    },
  )

  it.each(payloads)(
    'keeps the proxy property %j a single key segment',
    async (payload) => {
      const source = json(docSql({ s: 'safe', items: [], map: {} })).$path
      const lookup = (source.map as any)[payload].$exists
      const query = dialect.sqlToQuery(lookup)

      expect(query.params[1]).toBe(`$."map".${JSON.stringify(payload)}`)
      await expect(executeQuery(db, lookup)).resolves.toBe(false)
    },
  )

  it.each(payloads)(
    'keeps %j inert in string predicates and $in',
    async (payload) => {
      const source = json(
        docSql({ s: 'safe', items: [{ name: 'safe' }], map: {} }),
      ).$path
      const predicates = [
        source.$filter((d) => d.s.$startsWith(payload)),
        source.$filter((d) => d.s.$regex(payload, 'q')),
        source.$filter((d) => d.s.$in([payload, `${payload}2`])),
        source.$filter((d) => d.s.$ne(payload)),
        source.items.$each.$match({ name: payload }),
      ]

      for (const node of predicates) {
        const query = dialect.sqlToQuery(node.$exists)
        expect(query.params).toHaveLength(2)
        expect(query.sql).not.toContain(payload)
      }
      await expect(
        Promise.all(predicates.map((node) => executeQuery(db, node.$exists))),
      ).resolves.toEqual([false, false, false, true, false])
    },
  )

  it.each(payloads)(
    'binds the p.sql(...) value %j outside the jsonpath text',
    async (payload) => {
      const source = json(docSql({ s: payload, items: [], map: {} })).$path
      const value = sql<string>`${payload}::text`
      const node = source.$filter((d, p) => d.s.$eq(p.sql(value)))
      const query = dialect.sqlToQuery(node.$exists)

      expect(query.params).toEqual([
        JSON.stringify({ s: payload, items: [], map: {} }),
        `$ ? (@."s" == $v1)`,
        payload,
      ])
      await expect(executeQuery(db, node.$exists)).resolves.toBe(true)
      await expect(
        executeQuery(
          db,
          source.$filter((d, p) =>
            d.s.$eq(p.sql(sql<string>`${`${payload}!`}::text`)),
          ).$exists,
        ),
      ).resolves.toBe(false)
    },
  )

  it('treats a regex pattern as a regex, never as jsonpath', async () => {
    const source = json(docSql({ s: 'a"b', items: [], map: {} })).$path

    await expect(
      executeQuery(db, source.$filter((d) => d.s.$regex('^a"b$')).$exists),
    ).resolves.toBe(true)
    await expect(
      executeQuery(
        db,
        source.$filter((d) => d.s.$regex('" && @ == @ && "')).$exists,
      ),
    ).resolves.toBe(false)
  })

  it('keeps hostile $match keys quoted', async () => {
    const hostileKey = `name" == "x" || @."name`
    const source = json(
      docSql({ s: 'safe', items: [{ name: 'x' }], map: {} }),
    ).$path
    const node = source.items.$each.$match({ [hostileKey]: 'x' } as any)

    expect(dialect.sqlToQuery(node.$exists).params[1]).toBe(
      `$."items"[*] ? (@.${JSON.stringify(hostileKey)} == "x")`,
    )
    await expect(executeQuery(db, node.$exists)).resolves.toBe(false)
  })

  it('rejects SQL fragments wherever a jsonpath value is expected', () => {
    const source = json(docSql({ s: 'safe', items: [], map: {} })).$path
    const fragment = sql`'x'` as any

    expect(() => source.$filter((d) => d.s.$eq(fragment))).toThrow(TypeError)
    expect(() => source.$filter((d) => d.s.$startsWith(fragment))).toThrow(
      TypeError,
    )
    expect(() => source.$filter((d) => d.s.$regex(fragment))).toThrow(TypeError)
    expect(() => source.$filter((d) => d.s.$in([fragment]))).toThrow(TypeError)
    expect(() => source.map.$key(fragment)).toThrow(TypeError)
    expect(() => source.items.$each.$match({ name: fragment })).toThrow(
      TypeError,
    )
  })
})
