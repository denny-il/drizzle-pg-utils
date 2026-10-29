import { randomUUID } from 'node:crypto'

import {
  asc,
  avg,
  count,
  eq,
  gt,
  type SQL,
  type SQLWrapper,
  sql,
} from 'drizzle-orm'
import {
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  QueryBuilder,
  text,
} from 'drizzle-orm/pg-core'
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  expectTypeOf,
  it,
  type TestContext,
} from 'vitest'

import { json } from '../../src/index.ts'
import {
  closeDatabase,
  createDatabase,
  dialect,
  executeQuery,
  type TestDatabase,
} from '../utils.ts'

type Audit = { score: number | null; mode: string }
type Doc = {
  n: number
  s: string
  ratio: string
  audits: Record<string, Audit>
  tags: string[]
  scores: Array<number | null>
  tree: { x: number; kids: Array<{ x: number; kids: Array<{ x: number }> }> }
}

const docValue = {
  n: 5,
  s: 'five',
  ratio: '7',
  audits: {
    fcp: { score: 0.5, mode: 'numeric' },
    lcp: { score: 1, mode: 'numeric' },
    manual: { score: null, mode: 'manual' },
  },
  tags: ['a', 'b'],
  scores: [1, null, 3],
  tree: { x: 1, kids: [{ x: 2, kids: [{ x: 3 }] }] },
} satisfies Doc

const docSql = (value: unknown = docValue) =>
  sql<Doc>`${JSON.stringify(value)}::text::jsonb`

const limits = pgTable('limits', {
  min: integer('min').notNull(),
  maybe: doublePrecision('maybe'),
  label: text('label').notNull(),
})

const query = (expression: SQLWrapper) =>
  dialect.sqlToQuery(expression.getSQL())

describe('JSON path variables, $test, strict mode, aggregates, $valueAs, $rows', () => {
  const doc = json(sql<Doc>`doc`).$path

  describe('SQL', () => {
    it('binds p.sql(...) values as jsonpath variables named in order', () => {
      const failing = doc.audits.$values.$filter((a, p) =>
        p.or(
          a.score.$lt(p.sql(limits.min)),
          a.mode.$in([p.sql(limits.label), 'manual']),
        ),
      )

      expect(query(failing.$exists)).toEqual({
        sql: `jsonb_path_exists(doc, $1::text::jsonpath, jsonb_build_object('v1', "limits"."min", 'v2', "limits"."label"), true)`,
        params: [
          `$."audits".* ? ((@."score" < $v1) || ((@."mode" == $v2) || (@."mode" == "manual")))`,
        ],
      })
      expect(query(failing.score.$query).sql).toBe(
        `jsonb_path_query_array(doc, $1::text::jsonpath, jsonb_build_object('v1', "limits"."min", 'v2', "limits"."label"))`,
      )
      expect(query(failing.$first).sql).toMatch(/^jsonb_path_query_first\(doc/)
    })

    it('keeps the indexable operators when no variable is used', () => {
      const literal = doc.audits.$values.$filter((a) => a.score.$lt(1))

      expect(query(literal.$exists).sql).toBe(`doc @? $1::text::jsonpath`)
      expect(query(doc.n.$test((n) => n.$gt(2))).sql).toBe(
        `doc @@ $1::text::jsonpath`,
      )
    })

    it('names a variable once however often it is compared', () => {
      const node = doc.audits.$values.$filter((a, p) => {
        const min = p.sql(limits.min)
        return p.and(a.score.$gte(min), p.not(a.score.$eq(min)))
      })

      expect(query(node.$exists)).toEqual({
        sql: `jsonb_path_exists(doc, $1::text::jsonpath, jsonb_build_object('v1', "limits"."min"), true)`,
        params: [
          `$."audits".* ? ((@."score" >= $v1) && (!(@."score" == $v1)))`,
        ],
      })
    })

    it('only binds the variables of predicates that survive', () => {
      const failing = (min?: SQL<number>) =>
        doc.audits.$values.$filter((a, p) =>
          p.and(
            a.mode.$eq('numeric'),
            min === undefined ? undefined : a.score.$lt(p.sql(min)),
          ),
        )

      expect(query(failing().$exists).sql).toBe(`doc @? $1::text::jsonpath`)
      expect(query(failing(sql<number>`1`).$exists).sql).toContain(
        `jsonb_build_object('v1', 1)`,
      )
    })

    it('keeps forked paths from sharing variables', () => {
      const base = doc.audits.$values.$filter((a, p) =>
        a.score.$gt(p.sql(limits.min)),
      )
      const byLabel = base.$filter((a, p) => a.mode.$eq(p.sql(limits.label)))
      const byScore = base.$filter((a, p) => a.score.$lt(p.sql(limits.maybe)))

      expect(query(byLabel.$exists).sql).toContain(
        `jsonb_build_object('v1', "limits"."min", 'v2', "limits"."label")`,
      )
      expect(query(byScore.$exists).sql).toContain(
        `jsonb_build_object('v1', "limits"."min", 'v2', "limits"."maybe")`,
      )
      expect(query(base.$exists).sql).toContain(
        `jsonb_build_object('v1', "limits"."min")`,
      )
    })

    it('renders $test against the current path', () => {
      expect(query(doc.n.$test((n) => n.$gt(2))).params).toEqual([`$."n" > 2`])
      expect(
        query(doc.audits.$test((a) => a.$key('fcp').score.$isNull)).params,
      ).toEqual([`$."audits"."fcp"."score" == null`])
      expect(
        query(
          doc.audits.$values.$test((a, p) =>
            p.and(a.score.$gt(0), a.mode.$filter((m) => m.$eq('x')).$exists),
          ),
        ).params,
      ).toEqual([
        `($."audits".*."score" > 0) && (exists($."audits".*."mode" ? (@ == "x")))`,
      ])
      // No condition: `@@` takes `true` as a predicate.
      expect(query(doc.$test(() => undefined)).params).toEqual(['true'])
      expect(query(doc.n.$test((n, p) => n.$gt(p.sql(limits.min))))).toEqual({
        sql: `jsonb_path_match(doc, $1::text::jsonpath, jsonb_build_object('v1', "limits"."min"), true)`,
        params: [`$."n" > $v1`],
      })
    })

    it('prefixes strict paths and renders $deep as .**', () => {
      const strict = json.path(sql<Doc>`doc`, { mode: 'strict' })

      expect(query(strict.$deep.$key('x').$query).params).toEqual([
        `strict $.**."x"`,
      ])
      expect(query(doc.tree.$deep.$query).params).toEqual([`$."tree".**`])
      expect(
        query(doc.$filter((d) => d.tree.$deep.$key('x').$eq(3)).$exists).params,
      ).toEqual([`$ ? (@."tree".**."x" == 3)`])
      expect(query(json.path(sql<Doc>`doc`, { mode: 'lax' }).n.$query)).toEqual(
        query(doc.n.$query),
      )
    })

    it('aggregates the yielded items in a scalar subquery', () => {
      expect(query(doc.tags.$each.$count)).toEqual({
        sql: `(select count(*)::int from jsonb_path_query(doc, $1::text::jsonpath) as "jsonb_path_items"(item))`,
        params: [`$."tags"[*]`],
      })
      expect(query(doc.scores.$each.$avg).sql).toBe(
        `(select avg(nullif("jsonb_path_items".item, 'null'::jsonb)::float8) from jsonb_path_query(doc, $1::text::jsonpath) as "jsonb_path_items"(item))`,
      )
    })

    it('renders $valueAs as JSON_VALUE with optional ON EMPTY / ON ERROR', () => {
      expect(query(doc.n.$valueAs('integer'))).toEqual({
        sql: `json_value(doc, $1::text::jsonpath returning integer)`,
        params: [`$."n"`],
      })
      expect(
        query(
          doc.n.$valueAs('double precision', {
            onEmpty: 'error',
            onError: 'null',
          }),
        ).sql,
      ).toBe(
        `json_value(doc, $1::text::jsonpath returning double precision error on empty null on error)`,
      )
      expect(
        query(
          doc.audits.$values
            .$filter((a, p) => a.score.$gt(p.sql(limits.min)))
            .score.$valueAs('text'),
        ).sql,
      ).toBe(
        `json_value(doc, $1::text::jsonpath passing "limits"."min" as v1 returning text)`,
      )
    })

    it('builds $rows as a lateral subquery over jsonb_path_query', () => {
      const reports = pgTable('reports', {
        id: integer('id').notNull(),
        doc: jsonb('doc').$type<Doc>().notNull(),
      })
      const audits = json(reports.doc).$path.audits.$entries.$rows(
        'audits',
        (entry, ordinality) => ({
          key: entry.key.$text,
          score: entry.value.score.$number,
          ordinality,
        }),
      )

      expect(
        new QueryBuilder()
          .select({ id: reports.id, key: audits.key })
          .from(reports)
          .crossJoinLateral(audits)
          .where(gt(audits.score, 0.5))
          .toSQL(),
      ).toEqual({
        sql: `select "reports"."id", "audits"."key" from "reports" cross join lateral (select jsonb_extract_path_text("jsonb_path_items".item, 'key') as "key", nullif(jsonb_extract_path("jsonb_path_items".item, 'value','score'), 'null'::jsonb)::float8 as "score", "jsonb_path_items".ord::int as "ordinality" from jsonb_path_query("reports"."doc", $1::text::jsonpath) with ordinality as "jsonb_path_items"(item, ord)) "audits" where "audits"."score" > $2`,
        params: [`$."audits" ? (@.type() == "object").keyvalue()`, 0.5],
      })
    })
  })

  describe('validation', () => {
    it('rejects values p.sql(...) cannot bind', () => {
      expect(() => doc.$filter((d, p) => d.n.$eq(p.sql(5 as any)))).toThrow(
        TypeError,
      )
      // Patterns and prefixes stay literal.
      expect(() =>
        doc.$filter((d, p) => d.s.$startsWith(p.sql(limits.label) as any)),
      ).toThrow(TypeError)
      expect(() =>
        doc.$filter((d, p) => d.s.$regex(p.sql(limits.label) as any)),
      ).toThrow(TypeError)
    })

    it('rejects malformed $test, $valueAs, $rows, and mode arguments', () => {
      expect(() => doc.$test('x' as any)).toThrow(TypeError)
      expect(() => doc.$test((() => 'x') as any)).toThrow(TypeError)
      expect(() => doc.n.$valueAs('numeric' as any)).toThrow(TypeError)
      expect(() =>
        doc.n.$valueAs('integer', { onError: 'zero' as any }),
      ).toThrow(TypeError)
      expect(() => doc.$rows(1 as any, () => ({}))).toThrow(TypeError)
      expect(() => doc.$rows('r', {} as any)).toThrow(TypeError)
      expect(() => doc.$rows('r', () => ({ n: 1 }) as any)).toThrow(
        'must be a SQL expression',
      )
      expect(() => doc.$rows('r', (item) => ({ n: item.n }) as any)).toThrow(
        'must be a SQL expression',
      )
      expect(() => json.path(sql<Doc>`doc`, { mode: 'loose' } as any)).toThrow(
        TypeError,
      )
    })
  })

  describe('types', () => {
    it('types variables by their SQL type', () => {
      doc.audits.$values.$filter((a, p) => {
        expectTypeOf(p.sql(limits.min)).toEqualTypeOf<
          ReturnType<typeof p.sql<typeof limits.min>>
        >()
        return p.and(
          a.score.$gt(p.sql(limits.min)),
          a.score.$lt(p.sql(limits.maybe)),
          a.mode.$eq(p.sql(sql<'manual'>`'manual'`)),
        )
      })
    })

    it('types terminals', () => {
      const strict = json.path(sql<Doc>`doc`, { mode: 'strict' })

      expectTypeOf(doc.n.$exists).toEqualTypeOf<SQL<boolean>>()
      expectTypeOf(strict.n.$exists).toEqualTypeOf<SQL<boolean | null>>()
      expectTypeOf(strict.n.$query).toEqualTypeOf<SQL<number[]>>()
      expectTypeOf(doc.n.$test((n) => n.$gt(1))).toEqualTypeOf<
        SQL<boolean | null>
      >()
      expectTypeOf(doc.tree.$deep.$query).toEqualTypeOf<SQL<unknown[]>>()
      expectTypeOf(strict.$deep.$exists).toEqualTypeOf<SQL<boolean | null>>()
      expectTypeOf(doc.tags.$each.$count).toEqualTypeOf<SQL<number>>()
      expectTypeOf(doc.scores.$each.$sum).toEqualTypeOf<SQL<number | null>>()
      expectTypeOf(doc.audits.$values.score.$max).toEqualTypeOf<
        SQL<number | null>
      >()
      expectTypeOf(doc.tags.$each).not.toHaveProperty('$sum')
      expectTypeOf(doc.tree.$deep).not.toHaveProperty('$avg')
      expectTypeOf(doc.ratio.$valueAs('integer')).toEqualTypeOf<
        SQL<number | null>
      >()
      expectTypeOf(doc.ratio.$valueAs('boolean')).toEqualTypeOf<
        SQL<boolean | null>
      >()
      expectTypeOf(doc.n.$valueAs('text')).toEqualTypeOf<SQL<string | null>>()
    })

    it('types $rows columns and their joins', () => {
      const reports = pgTable('reports', {
        id: integer('id').notNull(),
        doc: jsonb('doc').$type<Doc>().notNull(),
      })
      const audits = json(reports.doc).$path.audits.$entries.$rows(
        'audits',
        (entry, ordinality) => {
          expectTypeOf(entry.key.$text).toEqualTypeOf<SQL<string>>()
          expectTypeOf(entry.value.score.$value).toEqualTypeOf<
            SQL<number | null>
          >()
          return {
            key: entry.key.$text,
            score: entry.value.score.$number,
            ordinality,
          }
        },
      )
      const builder = new QueryBuilder()
      const cross = builder.select().from(reports).crossJoinLateral(audits)
      const left = builder
        .select()
        .from(reports)
        .leftJoinLateral(audits, sql`true`)

      expectTypeOf<Awaited<(typeof cross)['_']['result']>>().toEqualTypeOf<
        Array<{
          reports: { id: number; doc: Doc }
          audits: { key: string; score: number | null; ordinality: number }
        }>
      >()
      expectTypeOf<Awaited<(typeof left)['_']['result']>>().toEqualTypeOf<
        Array<{
          reports: { id: number; doc: Doc }
          audits: {
            key: string
            score: number | null
            ordinality: number
          } | null
        }>
      >()
    })

    it('rejects misuse at compile time', () => {
      // Never called: `pnpm check:type` verifies the expected errors.
      const _expectTypeErrors = () => {
        doc.audits.$values.$filter((a, p) =>
          // @ts-expect-error a number variable cannot match a string field.
          a.mode.$eq(p.sql(limits.min)),
        )
        doc.audits.$values.$filter((a, p) =>
          // @ts-expect-error untyped SQL carries no type to check.
          a.score.$gt(p.sql(sql`1`)),
        )
        doc.audits.$values.$filter((a, p) =>
          // @ts-expect-error values are not SQL.
          a.score.$gt(p.sql(1)),
        )
        // @ts-expect-error only listed types.
        void doc.n.$valueAs('numeric')
        // @ts-expect-error aggregates need number items.
        void doc.s.$sum
        // @ts-expect-error columns must be SQL, not refs.
        void doc.$rows('r', (item) => ({ n: item.n }))
        // @ts-expect-error mode is lax or strict.
        void json.path(sql<Doc>`doc`, { mode: 'loose' })
      }
    })
  })

  describe('evaluation', () => {
    let db: TestDatabase
    let serverVersion: number
    const run = (expression: SQLWrapper) => executeQuery(db, expression)
    const live = json(docSql()).$path
    const strict = json.path(docSql(), { mode: 'strict' })
    // JSON_VALUE needs PostgreSQL 17.
    const requireJsonValue = (context: TestContext) => {
      if (serverVersion < 170000) context.skip()
    }

    beforeAll(async () => {
      db = await createDatabase()
      serverVersion = Number(
        await run(sql`current_setting('server_version_num')`),
      )
    })

    afterAll(async () => {
      await closeDatabase(db)
    })

    describe('variables', () => {
      it('compares against typed SQL values', async () => {
        const above = (min: SQL<number>) =>
          live.audits.$values.$filter((a, p) => a.score.$gt(p.sql(min))).score

        expect(await run(above(sql<number>`0.5::float8`).$query)).toEqual([1])
        expect(await run(above(sql<number>`0.4::numeric`).$query)).toEqual([
          0.5, 1,
        ])
        expect(await run(above(sql<number>`2::int`).$exists)).toBe(false)
        expect(await run(above(sql<number>`0::int`).$first)).toBe(0.5)
      })

      it('keeps comparisons type-strict and maps SQL NULL to JSON null', async () => {
        const scoreIs = (value: SQL<string | null> | SQL<number | null>) =>
          live.audits.$values.$filter((a, p) =>
            a.score.$eq(p.sql(value as SQL<number | null>)),
          ).mode.$query

        // The text '1' is a JSON string, which never equals the number 1.
        expect(await run(scoreIs(sql<string>`'1'::text`))).toEqual([])
        expect(await run(scoreIs(sql<number>`1::int`))).toEqual(['numeric'])
        expect(await run(scoreIs(sql<null>`null::int`))).toEqual(['manual'])
      })

      it('feeds $in, $test, and nested filters', async () => {
        const modes = live.audits.$values.$filter((a, p) =>
          a.mode.$in([p.sql(sql<string>`'manual'::text`), 'binary']),
        )

        expect(await run(modes.$count)).toBe(1)
        expect(
          await run(live.n.$test((n, p) => n.$eq(p.sql(sql<number>`5::int`)))),
        ).toBe(true)
        expect(
          await run(
            live.$filter(
              (d, p) =>
                d.audits.$values.$filter((a) =>
                  a.score.$gte(p.sql(sql<number>`1::int`)),
                ).$exists,
            ).$exists,
          ),
        ).toBe(true)
      })

      it('correlates with columns of the outer query', async () => {
        const tableName = `json_vars_${randomUUID().replaceAll('-', '').slice(0, 8)}`
        const reports = pgTable(tableName, {
          id: integer('id').notNull(),
          min: doublePrecision('min').notNull(),
          doc: jsonb('doc').$type<Doc>().notNull(),
        })

        await db.execute(
          sql`create table ${reports} (id integer not null, min float8 not null, doc jsonb not null)`,
        )
        try {
          await db.insert(reports).values([
            { id: 1, min: 0.9, doc: docValue },
            { id: 2, min: 2, doc: docValue },
          ])
          const report = json(reports.doc).$path
          const passing = report.audits.$values.$filter((a, p) =>
            a.score.$gte(p.sql(reports.min)),
          )
          const rows = await db
            .select({ id: reports.id, count: passing.$count })
            .from(reports)
            .where(passing.$exists)

          expect(rows).toEqual([{ id: 1, count: 1 }])
        } finally {
          await db.execute(sql`drop table ${reports}`)
        }
      })
    })

    describe('$test', () => {
      it('returns the predicate result, NULL when it is unknown', async () => {
        expect(await run(live.n.$test((n) => n.$gt(2)))).toBe(true)
        expect(await run(live.n.$test((n) => n.$gt(9)))).toBe(false)
        // `ratio` holds the string "7": a numeric comparison is unknown.
        const loose = json(docSql() as SQL<unknown>).$path
        expect(await run(loose.$key('ratio').$test((r) => r.$gt(2)))).toBeNull()
        expect(
          await run(loose.$filter((d) => d.$key('ratio').$gt(2)).$exists),
        ).toBe(false)
        expect(await run(live.$test(() => undefined))).toBe(true)
        expect(
          await run(
            json(sql<Doc | null>`null::jsonb`).$path.$test(() => undefined),
          ),
        ).toBeNull()
      })

      it('is true when any yielded item satisfies the predicate', async () => {
        expect(
          await run(live.audits.$values.$test((a) => a.score.$gt(0.9))),
        ).toBe(true)
        expect(await run(live.tags.$each.$test((t) => t.$eq('z')))).toBe(false)
      })
    })

    describe('$deep and strict mode', () => {
      const repeated = json(
        docSql({ x: [{ x: 1 }, { y: { x: 2 } }], a: { x: 3 } }),
      )

      it('finds keys at any depth', async () => {
        expect(await run(strict.tree.$deep.$key('x').$query)).toEqual([1, 2, 3])
        expect(
          await run(live.$filter((d) => d.$deep.$key('x').$eq(3)).$exists),
        ).toBe(true)
      })

      it('yields items reached through arrays twice in lax mode only', async () => {
        const lax = repeated.$path.$deep.$key('x').$filter((x) => x.$eq(1))
        const strictly = json
          .path(repeated.$value, { mode: 'strict' })
          .$deep.$key('x')
          .$filter((x) => x.$eq(1))

        expect(await run(lax.$query)).toEqual([1, 1])
        expect(await run(strictly.$query)).toEqual([1])
        expect(await run(lax.$count)).toBe(2)
      })

      it('raises on missing keys in strict queries but not in $exists', async () => {
        const missing = json.path(docSql({ n: 1 }), { mode: 'strict' }).s

        await expect(run(missing.$query)).rejects.toThrow()
        expect(await run(missing.$exists)).toBeNull()
        expect(await run(strict.n.$query)).toEqual([5])
        // Steps right after `.**` skip items that lack the key.
        expect(await run(strict.$deep.$key('score').$count)).toBe(3)
      })
    })

    describe('aggregates', () => {
      it('counts items, JSON null included', async () => {
        expect(await run(live.scores.$each.$count)).toBe(3)
        expect(await run(live.audits.$values.$count)).toBe(3)
        expect(
          await run(live.tags.$each.$filter((t) => t.$eq('z')).$count),
        ).toBe(0)
        expect(await run(json(sql<Doc>`null::jsonb`).$path.tags.$count)).toBe(0)
      })

      it('sums, averages, and bounds numbers, ignoring JSON null', async () => {
        expect(await run(live.scores.$each.$sum)).toBe(4)
        expect(await run(live.scores.$each.$avg)).toBe(2)
        expect(await run(live.scores.$each.$min)).toBe(1)
        expect(await run(live.audits.$values.score.$max)).toBe(1)
      })

      it('returns SQL NULL when no number is left', async () => {
        const empty = json(docSql({ scores: [] as number[] })).$path
        const nulls = json(docSql({ scores: [null, null] })).$path

        expect(await run(empty.scores.$each.$sum)).toBeNull()
        expect(await run(nulls.scores.$each.$avg)).toBeNull()
        expect(await run(nulls.scores.$each.$count)).toBe(2)
      })
    })

    describe('$valueAs (PostgreSQL 17+)', () => {
      it('converts the single scalar, numeric strings included', async (context) => {
        requireJsonValue(context)
        expect(await run(live.ratio.$valueAs('integer'))).toBe(7)
        expect(await run(live.n.$valueAs('double precision'))).toBe(5)
        expect(await run(live.n.$valueAs('text'))).toBe('5')
        expect(
          await run(
            json(docSql({ b: 'true' }))
              .$path.$key('b')
              .$valueAs('boolean'),
          ),
        ).toBe(true)
      })

      it('returns SQL NULL for no item, several, objects, and failed conversions', async (context) => {
        requireJsonValue(context)
        expect(await run(live.$key('missing').$valueAs('integer'))).toBeNull()
        expect(await run(live.tags.$each.$valueAs('text'))).toBeNull()
        expect(await run(live.tree.$valueAs('text'))).toBeNull()
        expect(await run(live.s.$valueAs('integer'))).toBeNull()
        expect(
          await run(live.audits.$key('manual').score.$valueAs('integer')),
        ).toBeNull()
      })

      it('raises instead when asked to', async (context) => {
        requireJsonValue(context)
        await expect(
          run(live.s.$valueAs('integer', { onError: 'error' })),
        ).rejects.toThrow()
        await expect(
          run(live.$key('missing').$valueAs('integer', { onEmpty: 'error' })),
        ).rejects.toThrow()
      })

      it('passes variables to the path', async (context) => {
        requireJsonValue(context)
        expect(
          await run(
            live.audits.$values
              .$filter((a, p) => a.score.$gt(p.sql(sql<number>`0.9::float8`)))
              .score.$valueAs('double precision'),
          ),
        ).toBe(1)
      })
    })

    describe('$rows', () => {
      const tableName = `json_rows_${randomUUID().replaceAll('-', '').slice(0, 8)}`
      const reports = pgTable(tableName, {
        id: integer('id').notNull(),
        doc: jsonb('doc').$type<Doc | null>(),
      })
      const audits = json(reports.doc).$path.audits.$entries.$rows(
        'audits',
        (entry, ordinality) => ({
          key: entry.key.$text,
          score: entry.value.score.$number,
          mode: entry.value.mode.$text,
          ordinality,
        }),
      )

      beforeAll(async () => {
        await db.execute(
          sql`create table ${reports} (id integer not null, doc jsonb)`,
        )
        await db.insert(reports).values([
          { id: 1, doc: docValue },
          { id: 2, doc: { ...docValue, audits: {} } },
          { id: 3, doc: null },
        ])
      })

      afterAll(async () => {
        await db.execute(sql`drop table ${reports}`)
      })

      it('turns items into typed, decoded rows', async () => {
        const rows = await db
          .select({
            id: reports.id,
            key: audits.key,
            score: audits.score,
            ordinality: audits.ordinality,
          })
          .from(reports)
          .crossJoinLateral(audits)
          .orderBy(asc(reports.id), asc(audits.key))

        expect(rows.map(({ ordinality: _, ...row }) => row)).toEqual([
          { id: 1, key: 'fcp', score: 0.5 },
          { id: 1, key: 'lcp', score: 1 },
          { id: 1, key: 'manual', score: null },
        ])
        expect(rows.map((row) => row.ordinality).sort()).toEqual([1, 2, 3])
      })

      it('keeps outer rows without items in a left join', async () => {
        const rows = await db
          .select({ id: reports.id, ordinality: audits.ordinality })
          .from(reports)
          .leftJoinLateral(audits, sql`true`)
          .where(sql`${audits.ordinality} is null`)
          .orderBy(asc(reports.id))

        // Drizzle types partial selections from lateral subqueries as
        // non-null; rows without items still come back with NULL columns.
        expect(rows).toEqual([
          { id: 2, ordinality: null },
          { id: 3, ordinality: null },
        ])
      })

      it('filters, groups, and aggregates with ordinary drizzle helpers', async () => {
        const rows = await db
          .select({
            id: reports.id,
            numeric: count(),
            average: avg(audits.score),
          })
          .from(reports)
          .crossJoinLateral(audits)
          .where(eq(audits.mode, 'numeric'))
          .groupBy(reports.id)

        expect(rows).toEqual([{ id: 1, numeric: 2, average: '0.75' }])
      })

      it('applies path filters and variables before the rows', async () => {
        const failing = json(reports.doc)
          .$path.audits.$values.$filter((a, p) =>
            a.score.$lt(p.sql(sql<number>`1::int`)),
          )
          .$rows('failing', (audit) => ({ score: audit.score.$number }))

        const rows = await db
          .select({ id: reports.id, score: failing.score })
          .from(reports)
          .crossJoinLateral(failing)

        expect(rows).toEqual([{ id: 1, score: 0.5 }])
      })

      it('nests by joining rows over a column of other rows', async () => {
        const kids = live.tree.kids.$each.$rows('kids', (kid) => ({
          x: kid.x.$number,
          kids: kid.kids.$value,
        }))
        const grandkids = json(kids.kids).$path.$each.$rows(
          'grandkids',
          (grandkid) => ({ x: grandkid.x.$number }),
        )

        expect(
          await db
            .select({ kid: kids.x, grandkid: grandkids.x })
            .from(kids)
            .crossJoinLateral(grandkids),
        ).toEqual([{ kid: 2, grandkid: 3 }])
      })

      it('unnests a bound JSON value without a table', async () => {
        const items = json(
          sql<Array<{ name: string } | null>>`${JSON.stringify([
            { name: 'a' },
            null,
            { name: 'b' },
          ])}::text::jsonb`,
        ).$path.$each.$rows('items', (item, ordinality) => ({
          name: item.name.$text,
          ordinality,
        }))

        expect(
          await db.select().from(items).orderBy(asc(items.ordinality)),
        ).toEqual([
          { name: 'a', ordinality: 1 },
          { name: null, ordinality: 2 },
          { name: 'b', ordinality: 3 },
        ])
      })
    })
  })
})
