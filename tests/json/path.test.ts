import { randomUUID } from 'node:crypto'

import { asc, isSQLWrapper, type SQL, type SQLWrapper, sql } from 'drizzle-orm'
import { integer, jsonb, pgTable } from 'drizzle-orm/pg-core'
import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from 'vitest'

import { json } from '../../src/index.ts'
import { path as namespacePath } from '../../src/json/index.ts'
import type { SQLJSONPathPredicate } from '../../src/json/operations/path.ts'
import {
  closeDatabase,
  createDatabase,
  dialect,
  executeQuery,
  type TestDatabase,
} from '../utils.ts'

type Audit = {
  id: string
  score: number | null
  mode: 'binary' | 'numeric' | 'manual'
  title: string
}
type Event =
  | { kind: 'click'; x: number; y: number }
  | { kind: 'key'; code: string }
type Doc = {
  n: number
  s: string
  nil: string | null
  mixed: string | number
  flag: boolean
  missing?: string
  tags: string[]
  audits: Record<string, Audit>
  events: Event[]
  pairs: Array<{ a: number; b: number }>
  '0': string
  $value: string
  'we"ird\nkey': number
}

const docValue = {
  n: 5,
  s: 'Alpha',
  nil: null,
  mixed: '5',
  flag: true,
  tags: ['a', 'b'],
  audits: {
    fcp: { id: 'fcp', score: 0.4, mode: 'numeric', title: 'First' },
    lcp: { id: 'lcp', score: 1, mode: 'numeric', title: 'Largest' },
    https: { id: 'https', score: 0, mode: 'binary', title: 'HTTPS' },
    manual: { id: 'manual', score: null, mode: 'manual', title: 'Manual' },
  },
  events: [
    { kind: 'click', x: 10, y: 1 },
    { kind: 'key', code: 'Enter' },
    { kind: 'click', x: 2, y: 3 },
  ],
  pairs: [
    { a: 1, b: 2 },
    { a: 2, b: 1 },
  ],
  '0': 'zero',
  $value: 'dollar',
  'we"ird\nkey': 7,
} satisfies Doc

// Bound like every other value, so drivers that inline or prepare differ only
// in how this one parameter travels.
const docSql = sql<Doc>`${JSON.stringify(docValue)}::text::jsonb`

/** The jsonpath text bound for a terminal: always the last parameter. */
const pathText = (terminal: SQLWrapper) =>
  dialect.sqlToQuery(terminal.getSQL()).params.at(-1)

const sortByKey = <T>(items: T[], key: (item: T) => string) =>
  [...items].sort((a, b) => key(a).localeCompare(key(b)))

describe('JSON path builder', () => {
  const doc = json(sql<Doc>`doc`).$path

  describe('SQL', () => {
    it('binds the whole path as one jsonpath parameter for each terminal', () => {
      const node = doc.audits.$key('fcp').score

      expect(dialect.sqlToQuery(node.$exists)).toEqual({
        sql: 'doc @? $1::text::jsonpath',
        params: ['$."audits"."fcp"."score"'],
      })
      expect(dialect.sqlToQuery(node.$query)).toEqual({
        sql: 'jsonb_path_query_array(doc, $1::text::jsonpath)',
        params: ['$."audits"."fcp"."score"'],
      })
      expect(dialect.sqlToQuery(node.$first)).toEqual({
        sql: 'jsonb_path_query_first(doc, $1::text::jsonpath)',
        params: ['$."audits"."fcp"."score"'],
      })
    })

    it('keeps the SQL text identical when only literal values change', () => {
      const bySize = (size: number) =>
        dialect.sqlToQuery(doc.$filter((d) => d.n.$gt(size)).$exists)

      expect(bySize(1).sql).toBe(bySize(2).sql)
      expect(bySize(1).params).toEqual(['$ ? (@."n" > 1)'])
      expect(bySize(2).params).toEqual(['$ ? (@."n" > 2)'])
    })

    it.each([
      ['the root', doc, '$'],
      ['a property', doc.n, '$."n"'],
      ['nested keys', doc.audits.$key('fcp').title, '$."audits"."fcp"."title"'],
      ['an array index', doc.tags[1], '$."tags"[1]'],
      ['the largest array index', doc.tags[2147483647], '$."tags"[2147483647]'],
      ['$each', doc.events.$each, '$."events"[*]'],
      ['$values', doc.audits.$values, '$."audits".*'],
      ['$entries', doc.audits.$entries, '$."audits".keyvalue()'],
      ['a numeric key', doc.$key('0'), '$."0"'],
      ['a helper-named key', doc.$key('$value'), '$."$value"'],
      ['an escaped key', doc.$key('we"ird\nkey'), '$."we\\"ird\\nkey"'],
    ])('navigates %s', (_, node, expected) => {
      expect(pathText(node.$query)).toBe(expected)
    })

    it.each([
      ['a root filter', doc.$filter((d) => d.n.$gt(3)), '$ ? (@."n" > 3)'],
      [
        'a scalar filter on @ itself',
        doc.n.$filter((n) => n.$lt(3)),
        '$."n" ? (@ < 3)',
      ],
      [
        'every comparison operator',
        doc.$filter((d, p) =>
          p.and(
            d.n.$eq(5),
            d.n.$ne(4),
            d.n.$lt(6),
            d.n.$lte(5),
            d.n.$gt(4),
            d.n.$gte(5),
          ),
        ),
        '$ ? ((@."n" == 5) && (@."n" != 4) && (@."n" < 6) && (@."n" <= 5) && (@."n" > 4) && (@."n" >= 5))',
      ],
      [
        'literal encoding',
        doc.$filter((d, p) =>
          p.and(
            d.nil.$eq(null),
            d.flag.$eq(false),
            d.mixed.$eq(-1.5),
            d.mixed.$lt(1e21),
            d.s.$eq('quote " backslash \\ newline \n'),
          ),
        ),
        '$ ? ((@."nil" == null) && (@."flag" == false) && (@."mixed" == -1.5) && (@."mixed" < 1e+21) && (@."s" == "quote \\" backslash \\\\ newline \\n"))',
      ],
      [
        'or and not',
        doc.audits.$values.$filter((a, p) =>
          p.or(a.mode.$eq('manual'), p.not(a.score.$gte(0.5))),
        ),
        '$."audits".* ? ((@."mode" == "manual") || (!(@."score" >= 0.5)))',
      ],
      [
        'skipped undefined operands',
        doc.$filter((d, p) => p.and(d.n.$lt(9), undefined)),
        '$ ? (@."n" < 9)',
      ],
      [
        'an all-undefined condition as no filter',
        doc.$filter((_, p) => p.and(p.or(), p.not(undefined), undefined)),
        '$',
      ],
      [
        '$in with several values',
        doc.audits.$values.$filter((a) => a.mode.$in(['binary', 'numeric'])),
        '$."audits".* ? ((@."mode" == "binary") || (@."mode" == "numeric"))',
      ],
      [
        '$in with one value',
        doc.audits.$values.$filter((a) => a.mode.$in(['binary'])),
        '$."audits".* ? (@."mode" == "binary")',
      ],
      [
        '$in with no values as false',
        doc.audits.$values.$filter((a) => a.mode.$in([])),
        '$."audits".* ? (1 == 0)',
      ],
      [
        '$in nested in and',
        doc.audits.$values.$filter((a, p) =>
          p.and(a.score.$lt(1), a.mode.$in(['binary', 'numeric'])),
        ),
        '$."audits".* ? ((@."score" < 1) && ((@."mode" == "binary") || (@."mode" == "numeric")))',
      ],
      [
        '$exists and $isNull',
        doc.$filter((d, p) => p.and(d.missing.$exists, d.nil.$isNull)),
        '$ ? ((exists(@."missing")) && (@."nil" == null))',
      ],
      [
        '$startsWith and $regex',
        doc.$filter((d, p) =>
          p.and(d.s.$startsWith('Al'), d.s.$regex('^al', 'i'), d.s.$regex('a')),
        ),
        '$ ? ((@."s" starts with "Al") && (@."s" like_regex "^al" flag "i") && (@."s" like_regex "a"))',
      ],
      [
        'a single-key $match',
        doc.events.$each.$match({ kind: 'click' }),
        '$."events"[*] ? (@."kind" == "click")',
      ],
      [
        'a multi-key $match',
        doc.events.$each.$match({ kind: 'click', x: 10 }),
        '$."events"[*] ? ((@."kind" == "click") && (@."x" == 10))',
      ],
      [
        'chained filters',
        doc.events.$each.$match({ kind: 'click' }).$filter((e) => e.x.$gt(5)),
        '$."events"[*] ? (@."kind" == "click") ? (@."x" > 5)',
      ],
      [
        'a nested filter',
        doc.$filter(
          (d) =>
            d.pairs.$each.$filter((pair, p) =>
              p.and(pair.a.$eq(1), pair.b.$eq(1)),
            ).$exists,
        ),
        '$ ? (exists(@."pairs"[*] ? ((@."a" == 1) && (@."b" == 1))))',
      ],
      [
        'filter-node navigation',
        doc.$filter((d, p) =>
          p.and(
            d.tags[0].$eq('a'),
            d.tags.$each.$eq('b'),
            d.audits.$values.score.$lt(1),
            d.$key('0').$eq('zero'),
            d.events.$each.$match({ kind: 'key' }).$exists,
          ),
        ),
        '$ ? ((@."tags"[0] == "a") && (@."tags"[*] == "b") && (@."audits".*."score" < 1) && (@."0" == "zero") && (exists(@."events"[*] ? (@."kind" == "key"))))',
      ],
      [
        'navigation after a filter',
        doc.audits.$entries.$filter((e) => e.key.$startsWith('f')).value.score,
        '$."audits".keyvalue() ? (@."key" starts with "f")."value"."score"',
      ],
    ])('filters with %s', (_, node, expected) => {
      expect(pathText(node.$exists)).toBe(expected)
    })

    it('forks paths without mutating the shared prefix', () => {
      const audits = doc.audits.$values
      const low = audits.$filter((a) => a.score.$lt(1))
      const high = audits.$filter((a) => a.score.$gte(1))

      expect(pathText(audits.$query)).toBe('$."audits".*')
      expect(pathText(low.$query)).toBe('$."audits".* ? (@."score" < 1)')
      expect(pathText(high.$query)).toBe('$."audits".* ? (@."score" >= 1)')
    })

    it('roots the path at columns, parameterized SQL, and expression aliases', () => {
      const docs = pgTable('path_docs', {
        doc: jsonb('doc').$type<Doc>().notNull(),
      })
      const withParam = sql<{ a: string }>`${'{"a":"x"}'}::text::jsonb`

      expect(dialect.sqlToQuery(json(docs.doc).$path.n.$exists)).toEqual({
        sql: '"path_docs"."doc" @? $1::text::jsonpath',
        params: ['$."n"'],
      })
      expect(dialect.sqlToQuery(json(withParam).$path.a.$query)).toEqual({
        sql: 'jsonb_path_query_array($1::text::jsonb, $2::text::jsonpath)',
        params: ['{"a":"x"}', '$."a"'],
      })
      expect(
        dialect.sqlToQuery(
          json(sql<{ a: string }>`'{}'::jsonb`.as('aliased')).$path.a.$first,
        ).sql,
      ).toBe(`jsonb_path_query_first('{}'::jsonb, $1::text::jsonpath)`)
    })

    it('exposes the same builder as json.path(...) and the path subpath export', () => {
      const source = sql<Doc>`doc`
      const fromRef = dialect.sqlToQuery(json(source).$path.n.$exists)

      expect(dialect.sqlToQuery(json.path(source).n.$exists)).toEqual(fromRef)
      expect(dialect.sqlToQuery(namespacePath(source).n.$exists)).toEqual(
        fromRef,
      )
    })

    it('keeps nodes out of SQL until a terminal is chosen', () => {
      expect(isSQLWrapper(doc.n)).toBe(false)
      expect(String(doc.n)).toBe('[object SQLJSONPath]')
      expect((doc.n as any).then).toBeUndefined()
      expect((doc.n as any).toJSON).toBeUndefined()
      expect((doc as any)[Symbol.iterator]).toBeUndefined()
    })
  })

  describe('validation', () => {
    it.each([
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['undefined', undefined],
      ['an object', { a: 1 }],
      ['an array', [1]],
      ['a bigint', 1n],
    ])('rejects %s as a comparison value', (_, value) => {
      expect(() => doc.$filter((d) => d.n.$eq(value as any))).toThrow(TypeError)
    })

    it('rejects non-orderable comparison values', () => {
      expect(() => doc.$filter((d) => d.mixed.$lt(true as any))).toThrow(
        TypeError,
      )
      expect(() => doc.$filter((d) => d.mixed.$gte(null as any))).toThrow(
        TypeError,
      )
    })

    it('rejects malformed string predicates', () => {
      expect(() => doc.$filter((d) => d.s.$startsWith(1 as any))).toThrow(
        TypeError,
      )
      expect(() => doc.$filter((d) => d.s.$regex(/a/ as any))).toThrow(
        TypeError,
      )
      // PostgreSQL does not implement `x`, and other letters are not flags.
      for (const flags of ['x', 'ix', 'g', ' i', 1])
        expect(() => doc.$filter((d) => d.s.$regex('a', flags as any))).toThrow(
          TypeError,
        )
      expect(() => doc.$filter((d) => d.s.$in('ab' as any))).toThrow(TypeError)
    })

    it.each(['-1', '01', '1.5', '1e3', '0x1', 'Infinity', '2147483648'])(
      'rejects %s as an array index',
      (index) => {
        expect(() => (doc.tags as any)[index]).toThrow(RangeError)
        expect(() =>
          doc.$filter((d) => (d.tags as any)[index].$eq('a')),
        ).toThrow(RangeError)
      },
    )

    it('rejects non-string keys', () => {
      expect(() => doc.$key(1 as any)).toThrow(TypeError)
    })

    it('rejects malformed $match shapes', () => {
      const events = doc.events.$each

      expect(() => events.$match({} as any)).toThrow(TypeError)
      expect(() => events.$match({ kind: undefined } as any)).toThrow(TypeError)
      expect(() => events.$match({ kind: { nested: 1 } } as any)).toThrow(
        TypeError,
      )
      expect(() => events.$match(['click'] as any)).toThrow(TypeError)
      expect(() => events.$match(null as any)).toThrow(TypeError)
    })

    it('rejects filter callbacks that do not return a path predicate', () => {
      expect(() => doc.$filter('n > 1' as any)).toThrow(TypeError)
      expect(() => doc.$filter(() => sql`true` as any)).toThrow(TypeError)
      expect(() => doc.$filter(() => true as any)).toThrow(TypeError)
    })

    it('rejects predicates used outside the callback that built them', () => {
      expect(() =>
        doc.$filter((d) => d.pairs.$each.$filter(() => d.n.$eq(5)).$exists),
      ).toThrow('outside the $filter callback')

      let inner: SQLJSONPathPredicate | undefined
      expect(() =>
        doc.$filter((d) => {
          d.pairs.$each.$filter((pair) => (inner = pair.a.$eq(1)))
          return inner
        }),
      ).toThrow('outside the $filter callback')
      expect(() =>
        doc.$filter((d, p) => p.and(d.n.$eq(5), inner, undefined)),
      ).toThrow('outside the $filter callback')
      expect(() => doc.$filter((_, p) => p.not(inner!))).toThrow(
        'outside the $filter callback',
      )
    })

    it('only builds paths from the root ref', () => {
      expect(() => (json(sql<Doc>`doc`).audits as any).$path).toThrow(
        'only supported at the root path',
      )
    })
  })

  describe('types', () => {
    it('types yielded items, keeping JSON null and dropping missing keys', () => {
      const docs = pgTable('path_typed_docs', {
        doc: jsonb('doc').$type<Doc>().notNull(),
        maybe: jsonb('maybe').$type<Doc>(),
      })

      expectTypeOf(doc.$exists).toEqualTypeOf<SQL<boolean>>()
      expectTypeOf(doc.$query).toEqualTypeOf<SQL<Doc[]>>()
      expectTypeOf(doc.n.$first).toEqualTypeOf<SQL<number | null>>()
      expectTypeOf(doc.nil.$query).toEqualTypeOf<SQL<Array<string | null>>>()
      expectTypeOf(doc.missing.$query).toEqualTypeOf<SQL<string[]>>()
      expectTypeOf(doc.tags[0].$first).toEqualTypeOf<SQL<string | null>>()
      expectTypeOf(doc.tags.$each.$query).toEqualTypeOf<SQL<string[]>>()
      expectTypeOf(doc.audits.$values.$query).toEqualTypeOf<SQL<Audit[]>>()
      expectTypeOf(doc.audits.$key('fcp').score.$query).toEqualTypeOf<
        SQL<Array<number | null>>
      >()
      expectTypeOf(doc.audits.$entries.$first).toEqualTypeOf<
        SQL<{ key: string; value: Audit; id: number } | null>
      >()
      expectTypeOf(doc.$key('0').$first).toEqualTypeOf<SQL<string | null>>()
      expectTypeOf(doc.$key('nope').$first).toEqualTypeOf<SQL<unknown>>()
      expectTypeOf(json(docs.doc).$path.$query).toEqualTypeOf<SQL<Doc[]>>()
      expectTypeOf(json(docs.maybe).$path.n.$query).toEqualTypeOf<
        SQL<number[] | null>
      >()
      expectTypeOf(json(sql<Doc | null>`doc`).$path.$query).toEqualTypeOf<
        SQL<Array<Doc | null> | null>
      >()
      // `NULL @? path` is NULL, not false.
      expectTypeOf(json(docs.maybe).$path.n.$exists).toEqualTypeOf<
        SQL<boolean | null>
      >()
      expectTypeOf(json(docs.doc).$path.n.$exists).toEqualTypeOf<SQL<boolean>>()
    })

    it('correlates $entries keys with their values', () => {
      const pair = json(sql<{ a: number; b: string }>`doc`).$path

      expectTypeOf(pair.$entries.$first).toEqualTypeOf<
        SQL<
          | { key: 'a'; value: number; id: number }
          | { key: 'b'; value: string; id: number }
          | null
        >
      >()
      expectTypeOf(
        pair.$entries.$match({ key: 'a' }).value.$query,
      ).toEqualTypeOf<SQL<number[]>>()
      // JSON object keys are always strings.
      expectTypeOf(
        json(sql<Record<number, string>>`doc`).$path.$entries.$first,
      ).toEqualTypeOf<
        SQL<{ key: `${number}`; value: string; id: number } | null>
      >()
      expectTypeOf(
        json(sql<{ 1: string }>`doc`).$path.$entries.$first,
      ).toEqualTypeOf<SQL<{ key: '1'; value: string; id: number } | null>>()
    })

    it('narrows union items with $match', () => {
      const clicks = doc.events.$each.$match({ kind: 'click' })

      expectTypeOf(clicks.x.$query).toEqualTypeOf<SQL<number[]>>()
      expectTypeOf(clicks.$first).toEqualTypeOf<
        SQL<{ kind: 'click'; x: number; y: number } | null>
      >()
      expectTypeOf(doc.events.$each.kind.$query).toEqualTypeOf<
        SQL<Array<'click' | 'key'>>
      >()
    })

    it('keeps every union item a widened $match value can match', () => {
      const match = (kind: Event['kind']) =>
        doc.events.$each.$match({ kind }).$first

      expectTypeOf(match).returns.toEqualTypeOf<SQL<Event | null>>()
    })

    it('leaves unknown JSON open to every navigation and predicate', () => {
      const anything = json(sql<unknown>`doc`).$path

      expectTypeOf(anything.$key('a').$each.$values.$query).toEqualTypeOf<
        SQL<unknown[] | null>
      >()
      expectTypeOf(anything.$entries.$first).toEqualTypeOf<
        SQL<{ key: string; value: unknown; id: number } | null>
      >()
      expectTypeOf(
        anything.$filter((node, p) =>
          p.and(
            node.$key('n').$lt(1),
            node.$key('s').$startsWith('a'),
            node.$eq(null),
          ),
        ).$exists,
      ).toEqualTypeOf<SQL<boolean | null>>()
    })

    it('offers predicates by item type', () => {
      doc.$filter((d) => {
        expectTypeOf(d.n).toHaveProperty('$lt')
        expectTypeOf(d.n).not.toHaveProperty('$startsWith')
        expectTypeOf(d.s).toHaveProperty('$regex')
        expectTypeOf(d.flag).toHaveProperty('$eq')
        expectTypeOf(d.flag).not.toHaveProperty('$lt')
        expectTypeOf(d.mixed).toHaveProperty('$lt')
        expectTypeOf(d.mixed).toHaveProperty('$startsWith')
        expectTypeOf(d.tags).not.toHaveProperty('$eq')
        expectTypeOf(d.tags).toHaveProperty('$exists')
        expectTypeOf(d.audits).not.toHaveProperty('$eq')
        return undefined
      })
    })

    it('rejects misuse at compile time', () => {
      // Never called: `pnpm check:type` verifies the expected errors.
      const _expectTypeErrors = () => {
        // @ts-expect-error ordering needs a number or string item.
        doc.$filter((d) => d.flag.$lt(1))
        // @ts-expect-error equality values follow the literal union.
        doc.audits.$values.$filter((a) => a.mode.$eq('nope'))
        // @ts-expect-error string predicates need a string item.
        doc.$filter((d) => d.n.$startsWith('1'))
        // @ts-expect-error comparisons take scalars, not objects.
        doc.audits.$values.$filter((a) => a.score.$eq({}))
        // @ts-expect-error arrays need $each before filtering (lax unwrapping).
        doc.tags.$filter((t) => t.$exists)
        // @ts-expect-error arrays need $each before matching.
        doc.events.$match({ kind: 'click' })
        // @ts-expect-error arrays have no member values.
        void doc.tags.$values
        // @ts-expect-error objects have no array items.
        void doc.audits.$each
        // @ts-expect-error numeric-looking keys go through $key(...).
        void doc['0']
        // @ts-expect-error helper-named keys go through $key(...).
        void doc.$value.$query
        // @ts-expect-error $match narrows away other union members.
        void doc.events.$each.$match({ kind: 'click' }).code
        // @ts-expect-error $match values follow the field type.
        doc.events.$each.$match({ kind: 'scroll' })
        // @ts-expect-error $match only takes known keys.
        doc.events.$each.$match({ nope: 1 })
        // @ts-expect-error $match only takes scalar fields.
        doc.$match({ tags: [] })
        // @ts-expect-error predicates only exist inside $filter callbacks.
        doc.n.$eq(5)
        // @ts-expect-error terminals only exist on path nodes.
        doc.$filter((d) => d.n.$query)
        // @ts-expect-error a node is not SQL until a terminal is chosen.
        const _node: SQL = doc.n
        // @ts-expect-error paths start at the root ref.
        void json(sql<Doc>`doc`).pairs.$path
        // @ts-expect-error dynamic Record keys go through $key(...).
        void doc.audits.fcp
      }
    })
  })

  describe('evaluation', () => {
    let db: TestDatabase
    const run = (expression: SQLWrapper) => executeQuery(db, expression)
    // Distinguishes SQL NULL (null) from JSON null ('null'), which both decode
    // to a JS null.
    const jsonType = (expression: SQLWrapper) =>
      run(sql`jsonb_typeof(${expression})`)
    const live = json(docSql).$path

    beforeAll(async () => {
      db = await createDatabase()
    })

    afterAll(async () => {
      await closeDatabase(db)
    })

    it('tests existence with @?', async () => {
      expect(await run(live.n.$exists)).toBe(true)
      expect(await run(live.missing.$exists)).toBe(false)
      expect(await run(live.nil.$exists)).toBe(true)
      expect(await run(live.tags[5].$exists)).toBe(false)
      expect(await run(live.events.$each.$match({ kind: 'key' }).$exists)).toBe(
        true,
      )
    })

    it('does not treat a comparison result as a match', async () => {
      // `@? '$.n < 3'` would be true here: the path yields the item `false`.
      expect(await run(live.$filter((d) => d.n.$lt(3)).$exists)).toBe(false)
      expect(await run(live.n.$filter((n) => n.$lt(3)).$exists)).toBe(false)
      expect(await run(live.n.$filter((n) => n.$gt(3)).$exists)).toBe(true)
    })

    it('keeps empty containers as matches until $each unwraps them', async () => {
      const empty = json(sql<{ items: string[] }>`'{"items":[]}'::jsonb`).$path

      expect(await run(empty.items.$exists)).toBe(true)
      expect(await run(empty.items.$each.$exists)).toBe(false)
      expect(await run(empty.items.$query)).toEqual([[]])
      expect(await run(empty.items.$each.$query)).toEqual([])
    })

    it('returns every match, none, and JSON null items from $query', async () => {
      expect(await run(live.tags.$each.$query)).toEqual(['a', 'b'])
      expect(await run(live.missing.$query)).toEqual([])
      expect(await run(live.nil.$query)).toEqual([null])
      expect(
        sortByKey(
          await run(
            live.audits.$values.$filter((a, p) =>
              p.and(a.score.$lt(1), a.mode.$in(['binary', 'numeric'])),
            ).$query,
          ),
          (audit: Audit) => audit.id,
        ),
      ).toEqual([docValue.audits.fcp, docValue.audits.https])
    })

    it('returns the first match or SQL NULL from $first', async () => {
      expect(await run(live.tags.$each.$first)).toBe('a')
      expect(await run(live.events[2].$match({ kind: 'click' }).x.$first)).toBe(
        2,
      )
      expect(await jsonType(live.missing.$first)).toBeNull()
      expect(await jsonType(live.nil.$first)).toBe('null')
    })

    it('propagates a SQL NULL source', async () => {
      const nothing = json(sql<Doc | null>`null::jsonb`).$path

      expect(await run(nothing.n.$exists)).toBeNull()
      expect(await jsonType(nothing.n.$query)).toBeNull()
      expect(await jsonType(nothing.n.$first)).toBeNull()
    })

    it('compares only values of the same JSON type', async () => {
      // `mixed` holds the string "5".
      expect(await run(live.$filter((d) => d.mixed.$eq(5)).$exists)).toBe(false)
      expect(await run(live.$filter((d) => d.mixed.$eq('5')).$exists)).toBe(
        true,
      )
      expect(await run(live.$filter((d) => d.mixed.$lt(9)).$exists)).toBe(false)
      expect(await run(live.$filter((d) => d.mixed.$lt('9')).$exists)).toBe(
        true,
      )
    })

    it('distinguishes JSON null, missing keys, and inequality', async () => {
      const matches = (fn: Parameters<typeof live.$filter>[0]) =>
        run(live.$filter(fn).$exists)

      expect(await matches((d) => d.nil.$isNull)).toBe(true)
      expect(await matches((d) => d.missing.$isNull)).toBe(false)
      expect(await matches((d) => d.nil.$exists)).toBe(true)
      expect(await matches((d) => d.missing.$exists)).toBe(false)
      expect(await matches((d, p) => p.not(d.missing.$exists))).toBe(true)
      // A comparison against a missing key is unknown, so neither form matches.
      expect(await matches((d) => d.missing.$ne('x'))).toBe(false)
      expect(await matches((d) => d.missing.$eq('x'))).toBe(false)
    })

    it('treats $ne as "some item differs", unlike not(...$eq)', async () => {
      const someTagIsNotA = live.$filter((d) => d.tags.$each.$ne('a'))
      const noTagIsA = live.$filter((d, p) => p.not(d.tags.$each.$eq('a')))

      expect(await run(someTagIsNotA.$exists)).toBe(true)
      expect(await run(noTagIsA.$exists)).toBe(false)
    })

    it('evaluates $in, $startsWith, and $regex', async () => {
      const matches = (fn: Parameters<typeof live.$filter>[0]) =>
        run(live.$filter(fn).$exists)

      expect(await matches((d) => d.s.$in(['Beta', 'Alpha']))).toBe(true)
      expect(await matches((d) => d.s.$in(['Beta']))).toBe(false)
      expect(await matches((d) => d.s.$in([]))).toBe(false)
      expect(await matches((d) => d.s.$startsWith('Al'))).toBe(true)
      expect(await matches((d) => d.s.$startsWith('al'))).toBe(false)
      expect(await matches((d) => d.s.$regex('^al'))).toBe(false)
      expect(await matches((d) => d.s.$regex('^al', 'i'))).toBe(true)
      expect(await matches((d) => d.s.$regex('a.', 'q'))).toBe(false)
    })

    it('combines optional conditions, skipping undefined ones', async () => {
      const failing = (mode?: Audit['mode']) =>
        live.audits.$values.$filter((a, p) =>
          p.and(
            a.score.$lt(1),
            mode === undefined ? undefined : a.mode.$eq(mode),
          ),
        ).$query

      expect(
        sortByKey(await run(failing()), (audit: Audit) => audit.id),
      ).toEqual([docValue.audits.fcp, docValue.audits.https])
      expect(await run(failing('binary'))).toEqual([docValue.audits.https])
    })

    it('navigates array items, indexes, member values, and entries', async () => {
      expect(await run(live.events[0].$query)).toEqual([docValue.events[0]])
      expect(await run(live.events.$each.kind.$query)).toEqual([
        'click',
        'key',
        'click',
      ])
      expect(
        sortByKey(await run(live.audits.$values.id.$query), (id: string) => id),
      ).toEqual(['fcp', 'https', 'lcp', 'manual'])
      expect(
        sortByKey(
          await run(
            live.audits.$entries.$filter((e) => e.value.score.$isNull).key
              .$query,
          ),
          (key: string) => key,
        ),
      ).toEqual(['manual'])
      expect(await run(live.$key('0').$first)).toBe('zero')
      expect(await run(live.$key('$value').$first)).toBe('dollar')
      expect(await run(live.$key('we"ird\nkey').$first)).toBe(7)
    })

    it('matches union items by discriminant', async () => {
      const clicks = live.events.$each.$match({ kind: 'click' })

      expect(await run(clicks.x.$query)).toEqual([10, 2])
      expect(await run(clicks.$filter((e) => e.x.$gt(5)).y.$query)).toEqual([1])
      expect(
        await run(live.events.$each.$match({ kind: 'click', x: 2 }).$query),
      ).toEqual([docValue.events[2]])
    })

    it('requires every condition of a nested filter on the same item', async () => {
      // `pairs` holds {a:1,b:2} and {a:2,b:1}: no single pair has a = b = 1.
      const samePair = live.$filter(
        (d) =>
          d.pairs.$each.$filter((pair, p) =>
            p.and(pair.a.$eq(1), pair.b.$eq(1)),
          ).$exists,
      )
      const anyPairs = live.$filter((d, p) =>
        p.and(d.pairs.$each.a.$eq(1), d.pairs.$each.b.$eq(1)),
      )

      expect(await run(samePair.$exists)).toBe(false)
      expect(await run(anyPairs.$exists)).toBe(true)
    })

    it('keeps hostile literals inert in the evaluated path', async () => {
      const hostile = `") || exists(@) || ("`
      const source = json(
        sql<{ s: string }>`${JSON.stringify({ s: hostile })}::text::jsonb`,
      ).$path

      expect(await run(source.$filter((d) => d.s.$eq(hostile)).$exists)).toBe(
        true,
      )
      expect(await run(source.$filter((d) => d.s.$eq('x')).$exists)).toBe(false)
      expect(await run(source.$key(hostile).$exists)).toBe(false)
    })

    it('runs inside typed drizzle selects and filters', async () => {
      const tableName = `json_path_${randomUUID().replaceAll('-', '').slice(0, 8)}`
      const reports = pgTable(tableName, {
        id: integer('id').notNull(),
        doc: jsonb('doc').$type<Doc>().notNull(),
      })
      const other = { ...docValue, audits: {}, n: 1 }

      await db.execute(
        sql`create table ${reports} (id integer not null, doc jsonb not null)`,
      )
      try {
        await db.insert(reports).values([
          { id: 1, doc: docValue },
          { id: 2, doc: other },
        ])

        const report = json(reports.doc).$path
        const failing = report.audits.$values.$filter((a) => a.score.$lt(1))
        const rows = await db
          .select({
            id: reports.id,
            failingIds: failing.id.$query,
            firstTag: report.tags.$each.$first,
          })
          .from(reports)
          .where(failing.$exists)
          .orderBy(asc(reports.id))

        expectTypeOf(rows).toEqualTypeOf<
          Array<{ id: number; failingIds: string[]; firstTag: string | null }>
        >()
        expect(rows).toHaveLength(1)
        expect(rows[0]!.id).toBe(1)
        expect(rows[0]!.failingIds.sort()).toEqual(['fcp', 'https'])
        expect(rows[0]!.firstTag).toBe('a')
      } finally {
        await db.execute(sql`drop table ${reports}`)
      }
    })
  })
})
