import { PGlite } from '@electric-sql/pglite'
import {
  type AnyRelations,
  type EmptyRelations,
  type SQLWrapper,
  sql,
} from 'drizzle-orm'
import { jsonb, PgDialect, pgTable } from 'drizzle-orm/pg-core'
import {
  drizzle as drizzlePglite,
  type PgliteDatabase,
} from 'drizzle-orm/pglite'
import {
  drizzle as drizzlePostgres,
  type PostgresJsDatabase,
} from 'drizzle-orm/postgres-js'
import postgres, { type Sql } from 'postgres'

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
    const client = postgres(process.env.DATABASE_URL, {
      idle_timeout: 1,
      max: 1,
    })
    return drizzlePostgres({
      client,
      relations: options.relations,
    }) as TestDatabase<TRelations>
  }

  const pglite = await PGlite.create()
  return drizzlePglite({
    client: pglite,
    relations: options.relations,
  }) as TestDatabase<TRelations>
}

export const executeQuery = async (
  client: TestDatabase,
  query: SQLWrapper,
): Promise<any> => {
  const rows = await executeRows<{ result: unknown }>(
    client,
    sql`select (${query}) as result`,
  )
  return rows[0]!.result
}

export const executeRows = async <TRow extends Record<string, unknown>>(
  client: TestDatabase,
  query: SQLWrapper,
): Promise<TRow[]> => {
  const results = await client.execute(query)
  return (Array.isArray(results) ? results : results.rows) as TRow[]
}
