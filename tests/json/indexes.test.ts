import { randomUUID } from 'node:crypto'
import { type SQLWrapper, sql } from 'drizzle-orm'
import { jsonb, pgTable } from 'drizzle-orm/pg-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { json } from '../../src/index.ts'
import { jsonAccess } from '../../src/json/operations/access.ts'
import { jsonContains } from '../../src/json/operations/contains.ts'
import { createDatabase, dialect, executeRows } from '../utils.ts'

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
  for (const tableName of createdTables) {
    await db.execute(sql.raw(`drop table if exists "${tableName}";`))
  }
})

const jsonbLiteral = (value: unknown) => sql`${JSON.stringify(value)}::jsonb`

const executeRaw = (statement: string) => db.execute(sql.raw(statement))

const explainQuery = async (query: SQLWrapper) => {
  await db.execute(sql.raw('begin'))

  try {
    await executeRaw('set local enable_seqscan = off;')
    const rows = await executeRows<ExplainQueryRow>(
      db,
      sql`explain (format json) ${query}`,
    )

    return rows[0]!['QUERY PLAN'][0]!.Plan
  } finally {
    await executeRaw('rollback')
  }
}

const runQuery = async <TRow extends Record<string, unknown>>(
  query: SQLWrapper,
) => executeRows<TRow>(db, query)

const findIndexNames = (plan: ExplainPlanNode): string[] => [
  ...(plan['Index Name'] ? [plan['Index Name']] : []),
  ...(plan.Plans?.flatMap(findIndexNames) ?? []),
]

const getRegisteredIndexExpression = async (indexName: string) => {
  const rows = await executeRows<{ expression?: string }>(
    db,
    sql`
      select pg_get_expr(i.indexprs, i.indrelid) as expression
      from pg_index i
      join pg_class c on c.oid = i.indexrelid
      where c.relname = ${indexName}
    `,
  )

  return rows[0]?.expression
}

const createSeededTable = async (suffix: string) => {
  const tableName = `jsonb_idx_${suffix}_${randomUUID().replaceAll('-', '').slice(0, tableNameSuffixLength)}`
  const indexedTable = pgTable(tableName, {
    data: jsonb('data').$type<IndexedJsonDocument>().notNull(),
  })

  await executeRaw(`
    create table "${tableName}" (
      data jsonb not null
    );
  `)

  await executeRaw(`
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

describe('JSONB index compatibility', () => {
  it('uses a default GIN index for root jsonb containment predicates', async () => {
    const { indexedTable, tableName } = await createSeededTable('gin')
    const indexName = `${tableName}_gin_idx`
    const kindAccessor = jsonAccess(indexedTable.data).kind.$text
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
    const [baselineRow] = await runQuery<{ kind: string }>(query)

    expect(baselineCount?.match_count).toBe(100)
    expect(baselineRow?.kind).toBe('alpha')

    await executeRaw(
      `create index "${indexName}" on "${tableName}" using gin (data);`,
    )

    const plan = await explainQuery(query)
    const [indexedRow] = await runQuery<{ kind: string }>(query)

    expect(findIndexNames(plan)).toContain(indexName)
    expect(indexedRow?.kind).toBe('alpha')
  })

  it('uses a jsonb_path_ops GIN index for nested root containment predicates', async () => {
    const { indexedTable, tableName } = await createSeededTable('path')
    const indexName = `${tableName}_path_idx`
    const emailAccessor = jsonAccess(indexedTable.data).profile.email.$text
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
    const [baselineRow] = await runQuery<{ email: string }>(query)

    expect(baselineCount?.match_count).toBe(1)
    expect(baselineRow?.email).toBe('user42@example.com')

    await executeRaw(
      `create index "${indexName}" on "${tableName}" using gin (data jsonb_path_ops);`,
    )

    const plan = await explainQuery(query)
    const [indexedRow] = await runQuery<{ email: string }>(query)

    expect(findIndexNames(plan)).toContain(indexName)
    expect(indexedRow?.email).toBe('user42@example.com')
  })

  it('uses a btree expression index built from a jsonAccess $text expression', async () => {
    const { indexedTable, tableName } = await createSeededTable('text')
    const indexName = `${tableName}_email_idx`
    const emailAccessor = jsonAccess(indexedTable.data).profile.email.$text
    const indexExpression = dialect.sqlToQuery(
      jsonAccess(sql<IndexedJsonDocument>`data`).profile.email.$text,
    ).sql
    const query = sql`
      select ${emailAccessor} as email
      from ${indexedTable}
      where ${emailAccessor} = ${'user42@example.com'}
    `

    expect(indexExpression).toBe(
      `jsonb_extract_path_text(data, 'profile','email')`,
    )
    expect(await getRegisteredIndexExpression(indexName)).toBeUndefined()
    expect(await runQuery<{ email: string }>(query)).toEqual([
      { email: 'user42@example.com' },
    ])

    await executeRaw(
      `create index "${indexName}" on "${tableName}" (${indexExpression});`,
    )

    const plan = await explainQuery(query)

    expect(await getRegisteredIndexExpression(indexName)).toBe(
      `jsonb_extract_path_text(data, VARIADIC ARRAY['profile'::text, 'email'::text])`,
    )
    expect(findIndexNames(plan)).toContain(indexName)
    expect(await runQuery<{ email: string }>(query)).toEqual([
      { email: 'user42@example.com' },
    ])
  })

  it('uses a GIN expression index built from a jsonAccess $value expression', async () => {
    const { indexedTable, tableName } = await createSeededTable('value')
    const indexName = `${tableName}_tags_idx`
    const tagsAccessor = jsonAccess(indexedTable.data).tags.$value
    const firstTagName = jsonAccess(indexedTable.data).tags['0'].name.$text
    const secondTagName = jsonAccess(indexedTable.data).tags['1'].name.$text
    const indexExpression = dialect.sqlToQuery(
      jsonAccess(sql<IndexedJsonDocument>`data`).tags.$value,
    ).sql
    const query = sql`
      select
        ${firstTagName} as first_tag_name,
        ${secondTagName} as second_tag_name
      from ${indexedTable}
      where ${tagsAccessor} @> ${jsonbLiteral([{ name: 'tag3' }])}
      order by ${firstTagName}, ${secondTagName}
    `

    expect(indexExpression).toBe(`jsonb_extract_path(data, 'tags')`)
    expect(await runQuery(query)).toHaveLength(20)

    await executeRaw(
      `create index "${indexName}" on "${tableName}" using gin ((${indexExpression}));`,
    )

    const plan = await explainQuery(query)
    const indexedRows = await runQuery<{
      first_tag_name: string
      second_tag_name: string
    }>(query)

    expect(await getRegisteredIndexExpression(indexName)).toBe(
      `jsonb_extract_path(data, VARIADIC ARRAY['tags'::text])`,
    )
    expect(findIndexNames(plan)).toContain(indexName)
    expect(indexedRows).toHaveLength(20)
    expect(new Set(indexedRows.map((row) => row.first_tag_name))).toEqual(
      new Set(['tag3']),
    )
    expect(new Set(indexedRows.map((row) => row.second_tag_name))).toEqual(
      new Set(['common']),
    )
  })

  it('uses a full-column GIN index for jsonContains nested predicates', async () => {
    const { indexedTable, tableName } = await createSeededTable('contains')
    const indexName = `${tableName}_gin_idx`
    const emailAccessor = jsonAccess(indexedTable.data).profile.email.$text
    const query = sql`
      select ${emailAccessor} as email
      from ${indexedTable}
      where ${jsonContains(indexedTable.data).profile.$contains({
        email: 'user42@example.com',
      })}
    `

    expect(await runQuery<{ email: string }>(query)).toEqual([
      { email: 'user42@example.com' },
    ])

    await executeRaw(
      `create index "${indexName}" on "${tableName}" using gin (data);`,
    )

    const plan = await explainQuery(query)

    expect(findIndexNames(plan)).toContain(indexName)
  })

  it('uses a full-column GIN index for ref nested containment predicates', async () => {
    const { indexedTable, tableName } = await createSeededTable('ref_contains')
    const indexName = `${tableName}_gin_idx`
    const data = json(indexedTable.data)
    const emailAccessor = data.profile.email.$text
    const query = sql`
      select ${emailAccessor} as email
      from ${indexedTable}
      where ${data.profile.$contains({
        email: 'user42@example.com',
      })}
    `

    expect(await runQuery<{ email: string }>(query)).toEqual([
      { email: 'user42@example.com' },
    ])

    await executeRaw(
      `create index "${indexName}" on "${tableName}" using gin (data);`,
    )

    const plan = await explainQuery(query)

    expect(findIndexNames(plan)).toContain(indexName)
  })

  it('uses a full-column jsonb_path_ops index for jsonContains array predicates', async () => {
    const { indexedTable, tableName } = await createSeededTable('array')
    const indexName = `${tableName}_path_idx`
    const firstTagName = jsonAccess(indexedTable.data).tags['0'].name.$text
    const query = sql`
      select ${firstTagName} as first_tag_name
      from ${indexedTable}
      where ${jsonContains(indexedTable.data).tags.$contains([{ name: 'tag7' }])}
      order by ${firstTagName}
    `

    const baselineRows = await runQuery<{ first_tag_name: string }>(query)

    expect(baselineRows).toHaveLength(20)
    expect(new Set(baselineRows.map((row) => row.first_tag_name))).toEqual(
      new Set(['tag7']),
    )

    await executeRaw(
      `create index "${indexName}" on "${tableName}" using gin (data jsonb_path_ops);`,
    )

    const plan = await explainQuery(query)

    expect(findIndexNames(plan)).toContain(indexName)
  })
})
