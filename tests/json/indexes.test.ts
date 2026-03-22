import { type SQLWrapper, sql } from 'drizzle-orm'
import { jsonb, pgTable } from 'drizzle-orm/pg-core'
import { beforeAll, describe, expect, it } from 'vitest'
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

let db: Awaited<ReturnType<typeof createDatabase>>

beforeAll(async () => {
  db = await createDatabase()
  await db.$client.exec('set enable_seqscan = off;')
})

const jsonbLiteral = (value: unknown) => sql`${JSON.stringify(value)}::jsonb`

const explainQuery = async (query: SQLWrapper) => {
  const compiled = dialect.sqlToQuery(query)
  const result = await db.$client.query(
    `explain ${compiled.sql}`,
    compiled.params,
  )

  return result.rows
    .map((row) => String((row as Record<string, unknown>)['QUERY PLAN']))
    .join('\n')
}

const runQuery = async <TRow extends Record<string, unknown>>(
  query: SQLWrapper,
) => {
  const compiled = dialect.sqlToQuery(query)
  const result = await db.$client.query(compiled.sql, compiled.params)
  return result.rows as TRow[]
}

const createSeededTable = async (suffix: string) => {
  const tableName = `jsonb_index_${suffix}`
  const indexedTable = pgTable(tableName, {
    data: jsonb('data').$type<IndexedJsonDocument>().notNull(),
  })

  await db.$client.exec(`
    create table "${tableName}" (
      id serial primary key,
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

  return { indexedTable, tableName }
}

describe('JSONB Index Compatibility', () => {
  it('works with default GIN indexes on the full jsonb column', async () => {
    const { indexedTable, tableName } = await createSeededTable('gin')
    const indexName = `${tableName}_data_gin_idx`
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

    const plan = await explainQuery(query)
    const [row] = await runQuery<{ kind: string }>(query)

    expect(plan).toContain(indexName)
    expect(row?.kind).toBe('alpha')
  })

  it('works with jsonb_path_ops indexes for nested containment queries', async () => {
    const { indexedTable, tableName } = await createSeededTable('path_ops')
    const indexName = `${tableName}_data_path_ops_idx`
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

    const plan = await explainQuery(query)
    const [row] = await runQuery<{ email: string }>(query)

    expect(plan).toContain(indexName)
    expect(row?.email).toBe('user42@example.com')
  })

  it('supports btree expression indexes built from jsonAccess $text expressions', async () => {
    const { indexedTable, tableName } = await createSeededTable('btree_expr')
    const indexName = `${tableName}_profile_email_idx`
    const emailAccessor = jsonAccess(indexedTable.data).profile.email.$text
    const indexExpression = dialect.sqlToQuery(
      jsonAccess(sql<IndexedJsonDocument>`data`).profile.email.$text,
    ).sql

    await db.$client.exec(
      `create index "${indexName}" on "${tableName}" (${indexExpression});`,
    )

    const query = sql`
      select ${emailAccessor} as email
      from ${indexedTable}
      where ${emailAccessor} = ${'user42@example.com'}
    `

    const plan = await explainQuery(query)
    const [row] = await runQuery<{ email: string }>(query)

    expect(plan).toContain(indexName)
    expect(row?.email).toBe('user42@example.com')
  })

  it('supports GIN expression indexes built from jsonAccess $value expressions', async () => {
    const { indexedTable, tableName } = await createSeededTable('gin_expr')
    const indexName = `${tableName}_tags_gin_idx`
    const tagsAccessor = jsonAccess(indexedTable.data).tags.$value
    const secondTagName = jsonAccess(indexedTable.data).tags['1'].name.$text
    const indexExpression = dialect.sqlToQuery(
      jsonAccess(sql<IndexedJsonDocument>`data`).tags.$value,
    ).sql

    await db.$client.exec(
      `create index "${indexName}" on "${tableName}" using gin ((${indexExpression}));`,
    )

    const query = sql`
      select ${secondTagName} as second_tag_name
      from ${indexedTable}
      where ${tagsAccessor} @> ${jsonbLiteral([{ name: 'common' }])}
      limit 1
    `

    const plan = await explainQuery(query)
    const [row] = await runQuery<{ second_tag_name: string }>(query)

    expect(plan).toContain(indexName)
    expect(row?.second_tag_name).toBe('common')
  })
})
