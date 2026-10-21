import { randomBytes } from 'node:crypto'

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
import { inject } from 'vitest'

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
    // Test files run in parallel against one shared database, so give every
    // call its own fresh schema, mirroring a fresh PGlite instance. Unqualified
    // DDL then can't race or collide with other files or with leftovers from
    // aborted runs. `search_path` is a startup parameter, so it also applies
    // when the pool reconnects after `idle_timeout`. Global setup drops the
    // schemas when the run finishes.
    const schema = `${inject('testSchemaPrefix')}${randomBytes(4).toString('hex')}`
    // postgres-js lets URL query params override `connection`, so a
    // `?search_path=` in DATABASE_URL would silently put every file back on a
    // shared schema.
    const url = new URL(process.env.DATABASE_URL)
    url.searchParams.delete('search_path')
    const client = postgres(url.href, {
      idle_timeout: 1,
      max: 1,
      connection: { search_path: schema },
    })
    await client`create schema ${client(schema)}`
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

export const closeDatabase = (client: TestDatabase): Promise<void> =>
  client.$client instanceof PGlite
    ? client.$client.close()
    : client.$client.end()
