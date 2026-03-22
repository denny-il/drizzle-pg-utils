import { randomUUID } from 'node:crypto'
import { type SQLWrapper, sql } from 'drizzle-orm'
import { jsonb, pgTable } from 'drizzle-orm/pg-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { jsonAccess } from '../../src/json/operations/access.ts'
import { createDatabase, dialect } from '../utils.ts'

type IndexedJsonDocument = {
  kind: 'alpha' | 'beta'
  profile: {
    email: string
    status: 'active' | 'inactive'
  }
  tags: Array<{ name: string }>
  flags: {
    featured: boolean
  }
}

type ExplainPlanNode = {
  'Index Name'?: string
  Plans?: ExplainPlanNode[]
}

type ExplainQueryRow = {
  'QUERY PLAN': Array<{
    Plan: ExplainPlanNode
  }>
}

let db: Awaited<ReturnType<typeof createDatabase>>
const createdTables: string[] = []
const tableNameSuffixLength = 8

beforeAll(async () => {
  db = await createDatabase()
})

afterAll(async () => {
  if (createdTables.length === 0) return

  await db.$client.exec(
    createdTables
      .map((tableName) => `drop table if exists "${tableName}";`)
      .join('\n'),
  )
})

const jsonbLiteral = (value: unknown) => sql`${JSON.stringify(value)}::jsonb`

const explainQuery = async (query: SQLWrapper) => {
  const compiled = dialect.sqlToQuery(query)
  await db.$client.exec('begin')

  try {
    // Keep the planner override transaction-scoped so it cannot leak into the
    // query correctness checks that run outside EXPLAIN.
    await db.$client.exec('set local enable_seqscan = off;')
    const result = await db.$client.query(
      `explain (format json) ${compiled.sql}`,
      compiled.params,
    )

    return (result.rows[0] as ExplainQueryRow)['QUERY PLAN'][0]!.Plan
  } finally {
    await db.$client.exec('rollback')
  }
}

const runQuery = async <TRow extends Record<string, unknown>>(
  query: SQLWrapper,
) => {
  const compiled = dialect.sqlToQuery(query)
  const result = await db.$client.query(compiled.sql, compiled.params)
  return result.rows as TRow[]
}

const findIndexNames = (plan: ExplainPlanNode): string[] => [
  ...(plan['Index Name'] ? [plan['Index Name']] : []),
  ...(plan.Plans?.flatMap(findIndexNames) ?? []),
]

const getRegisteredIndexExpression = async (indexName: string) => {
  const result = await db.$client.query(
    `
      select pg_get_expr(i.indexprs, i.indrelid) as expression
      from pg_index i
      join pg_class c on c.oid = i.indexrelid
      where c.relname = $1
    `,
    [indexName],
  )

  return result.rows[0]?.expression as string | undefined
}

const createSeededTable = async (suffix: string) => {
  const tableName = `jsonb_idx_${suffix}_${randomUUID().replaceAll('-', '').slice(0, tableNameSuffixLength)}`
  const indexedTable = pgTable(tableName, {
    data: jsonb('data').$type<IndexedJsonDocument>().notNull(),
  })

  await db.$client.exec(`
    create table "${tableName}" (
      data jsonb not null
    );

    insert into "${tableName}" (data)
    select jsonb_build_object(
      'kind', case when g % 2 = 0 then 'alpha' else 'beta' end,
      'profile', jsonb_build_object(
        'email', 'user' || g || '@example.com',
        'status', case when g % 3 = 0 then 'active' else 'inactive' end
      ),
      'tags', jsonb_build_array(
        jsonb_build_object('name', 'tag' || (g % 10)),
        jsonb_build_object('name', 'common')
      ),
      'flags', jsonb_build_object('featured', (g % 5 = 0))
    )
    from generate_series(1, 200) as g;
  `)
  createdTables.push(tableName)

  return { indexedTable, tableName }
}

describe('JSONB Index Compatibility', () => {
  it('works with default GIN indexes on the full jsonb column', async () => {
    const { indexedTable, tableName } = await createSeededTable('gin')
    const indexName = `${tableName}_gin_idx`
    const kindAccessor = jsonAccess(indexedTable.data).kind.$text

    await db.$client.exec(
      `create index "${indexName}" on "${tableName}" using gin (data);`,
    )

    const query = sql`
      select ${kindAccessor} as kind
      from ${indexedTable}
      where ${indexedTable.data} @> ${jsonbLiteral({ kind: 'alpha' })}
      limit 1
    `
    const countQuery = sql`
      select count(*)::int as match_count
      from ${indexedTable}
      where ${indexedTable.data} @> ${jsonbLiteral({ kind: 'alpha' })}
    `

    const [baselineCount] = await runQuery<{ match_count: number }>(countQuery)

    const plan = await explainQuery(query)
    const [row] = await runQuery<{ kind: string }>(query)
    const [indexedCount] = await runQuery<{ match_count: number }>(countQuery)

    expect(baselineCount?.match_count).toBe(100)
    expect(findIndexNames(plan)).toContain(indexName)
    expect(row?.kind).toBe('alpha')
    expect(indexedCount?.match_count).toBe(100)
  })

  it('works with jsonb_path_ops indexes for nested containment queries', async () => {
    const { indexedTable, tableName } = await createSeededTable('path')
    const indexName = `${tableName}_path_idx`
    const emailAccessor = jsonAccess(indexedTable.data).profile.email.$text

    await db.$client.exec(
      `create index "${indexName}" on "${tableName}" using gin (data jsonb_path_ops);`,
    )

    const query = sql`
      select ${emailAccessor} as email
      from ${indexedTable}
      where ${indexedTable.data} @> ${jsonbLiteral({
        profile: { email: 'user42@example.com' },
      })}
    `
    const countQuery = sql`
      select count(*)::int as match_count
      from ${indexedTable}
      where ${indexedTable.data} @> ${jsonbLiteral({
        profile: { email: 'user42@example.com' },
      })}
    `

    const [baselineCount] = await runQuery<{ match_count: number }>(countQuery)

    const plan = await explainQuery(query)
    const [row] = await runQuery<{ email: string }>(query)
    const [indexedCount] = await runQuery<{ match_count: number }>(countQuery)

    expect(baselineCount?.match_count).toBe(1)
    expect(findIndexNames(plan)).toContain(indexName)
    expect(row?.email).toBe('user42@example.com')
    expect(indexedCount?.match_count).toBe(1)
  })

  it('supports btree expression indexes built from jsonAccess $text expressions', async () => {
    const { indexedTable, tableName } = await createSeededTable('text')
    const indexName = `${tableName}_email_idx`
    const emailAccessor = jsonAccess(indexedTable.data).profile.email.$text
    const indexExpression = dialect.sqlToQuery(
      jsonAccess(sql<IndexedJsonDocument>`data`).profile.email.$text,
    ).sql
    const baselineQuery = sql`
      select ${emailAccessor} as email
      from ${indexedTable}
      where ${emailAccessor} = ${'user42@example.com'}
    `

    expect(indexExpression).toBe(
      `jsonb_extract_path_text(data, 'profile','email')`,
    )
    expect(await getRegisteredIndexExpression(indexName)).toBeUndefined()

    const baselineRows = await runQuery<{ email: string }>(baselineQuery)

    await db.$client.exec(
      `create index "${indexName}" on "${tableName}" (${indexExpression});`,
    )
    const registeredExpression = await getRegisteredIndexExpression(indexName)

    const plan = await explainQuery(baselineQuery)
    const [row] = await runQuery<{ email: string }>(baselineQuery)

    expect(baselineRows).toEqual([{ email: 'user42@example.com' }])
    expect(registeredExpression).toBe(
      `jsonb_extract_path_text(data, VARIADIC ARRAY['profile'::text, 'email'::text])`,
    )
    expect(findIndexNames(plan)).toContain(indexName)
    expect(row?.email).toBe('user42@example.com')
  })

  it('supports GIN expression indexes built from jsonAccess $value expressions', async () => {
    const { indexedTable, tableName } = await createSeededTable('value')
    const indexName = `${tableName}_tags_idx`
    const tagsAccessor = jsonAccess(indexedTable.data).tags.$value
    const firstTagName = jsonAccess(indexedTable.data).tags['0'].name.$text
    const secondTagName = jsonAccess(indexedTable.data).tags['1'].name.$text
    const indexExpression = dialect.sqlToQuery(
      jsonAccess(sql<IndexedJsonDocument>`data`).tags.$value,
    ).sql
    const baselineQuery = sql`
      select
        ${firstTagName} as first_tag_name,
        ${secondTagName} as second_tag_name
      from ${indexedTable}
      where ${tagsAccessor} @> ${jsonbLiteral([{ name: 'tag3' }])}
      order by ${firstTagName}, ${secondTagName}
    `

    expect(indexExpression).toBe(`jsonb_extract_path(data, 'tags')`)

    await db.$client.exec(
      `create index "${indexName}" on "${tableName}" using gin ((${indexExpression}));`,
    )
    const registeredExpression = await getRegisteredIndexExpression(indexName)

    const baselineRows = await runQuery<{
      first_tag_name: string
      second_tag_name: string
    }>(baselineQuery)
    const plan = await explainQuery(baselineQuery)
    const indexedRows = await runQuery<{
      first_tag_name: string
      second_tag_name: string
    }>(baselineQuery)

    expect(registeredExpression).toBe(
      `jsonb_extract_path(data, VARIADIC ARRAY['tags'::text])`,
    )
    expect(baselineRows).toHaveLength(20)
    expect(new Set(baselineRows.map((row) => row.first_tag_name))).toEqual(
      new Set(['tag3']),
    )
    expect(new Set(baselineRows.map((row) => row.second_tag_name))).toEqual(
      new Set(['common']),
    )
    expect(findIndexNames(plan)).toContain(indexName)
    expect(indexedRows).toEqual(baselineRows)
  })
})
