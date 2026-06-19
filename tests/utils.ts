import type { PGlite } from '@electric-sql/pglite'
import {
  type AnyRelations,
  type EmptyRelations,
  type SQLWrapper,
  sql,
} from 'drizzle-orm'
import { jsonb, PgDialect, pgTable } from 'drizzle-orm/pg-core'
import type { PgliteDatabase } from 'drizzle-orm/pglite'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type { Sql } from 'postgres'

export const dialect = new PgDialect()

export const table = pgTable('test', {
  jsoncol: jsonb('jsoncol').$type<{ some: 'json' }>().notNull(),
  jsoncolNullable: jsonb('jsoncolNullable').$type<{ some: 'json' }>(),
  arraycol: jsonb('arraycol')
    .$type<Array<{ id: number; name: string }>>()
    .notNull(),
  arraycolNullable:
    jsonb('arraycolNullable').$type<Array<{ id: number; name: string }>>(),
})

export type TestDatabase<TRelations extends AnyRelations = EmptyRelations> =
  | (PgliteDatabase<TRelations> & { $client: PGlite })
  | (PostgresJsDatabase<TRelations> & { $client: Sql })

type CreateDatabaseOptions<TRelations extends AnyRelations> = {
  relations?: TRelations
}

export const createDatabase = async <
  TRelations extends AnyRelations = EmptyRelations,
>(
  options: CreateDatabaseOptions<TRelations> = {},
): Promise<TestDatabase<TRelations>> => {
  if (process.env.DATABASE_URL) {
    const [{ drizzle }, postgres] = await Promise.all([
      import('drizzle-orm/postgres-js'),
      import('postgres'),
    ])
    const client = postgres.default(process.env.DATABASE_URL, {
      idle_timeout: 1,
      max: 1,
    })
    return drizzle({
      client,
      relations: options.relations,
    }) as TestDatabase<TRelations>
  }

  const [{ PGlite }, { drizzle }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('drizzle-orm/pglite'),
  ])
  const pglite = await PGlite.create()
  return drizzle({
    client: pglite,
    relations: options.relations,
  }) as TestDatabase<TRelations>
}

export const executeQuery = async (
  client: TestDatabase,
  query: SQLWrapper,
): Promise<any> => {
  const results = await client.execute(sql`select (${query}) as result`)
  const rows = getRows<{ result: any }>(results)
  return rows[0]!.result
}

export const getRows = <TRow>(results: TRow[] | { rows: TRow[] }): TRow[] =>
  Array.isArray(results) ? results : results.rows
