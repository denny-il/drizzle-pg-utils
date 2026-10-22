import { randomBytes } from 'node:crypto'

import {
  type AnyRelations,
  type EmptyRelations,
  type SQLWrapper,
  sql,
} from 'drizzle-orm'
import { jsonb, PgDialect, pgTable } from 'drizzle-orm/pg-core'
import { inject } from 'vitest'

import {
  connect,
  embeddedDrivers,
  type TestDatabase,
  testDriver,
} from './drivers.ts'

export { type TestDatabase, type TestDriver, testDriver } from './drivers.ts'

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

type CreateDatabaseOptions<TRelations extends AnyRelations> = {
  relations?: TRelations
}

export const createDatabase = async <
  TRelations extends AnyRelations = EmptyRelations,
>(
  options: CreateDatabaseOptions<TRelations> = {},
): Promise<TestDatabase<TRelations>> => {
  if (embeddedDrivers.includes(testDriver)) {
    return register(
      await connect({ relations: options.relations, url: '', schema: '' }),
    )
  }

  // Test files run in parallel against one shared database, so give every
  // call its own fresh schema, mirroring a fresh PGlite instance. Unqualified
  // DDL then can't race or collide with other files or with leftovers from
  // aborted runs. Global setup drops the schemas when the run finishes.
  const schema = `${inject('testSchemaPrefix')}${randomBytes(4).toString('hex')}`
  // Drivers let URL query params override explicit connection options, so a
  // `?search_path=` or `?options=` in DATABASE_URL would silently put every
  // file back on a shared schema.
  const url = new URL(process.env.DATABASE_URL!)
  url.searchParams.delete('search_path')
  url.searchParams.delete('options')
  const db = register<TRelations>(
    await connect({ relations: options.relations, url: url.href, schema }),
  )
  // `search_path` may name a schema before it exists.
  await db.execute(sql`create schema ${sql.identifier(schema)}`)
  return db
}

const closers = new WeakMap<TestDatabase<any>, () => Promise<void>>()

const register = <TRelations extends AnyRelations>(connection: {
  db: unknown
  close: () => Promise<void>
}) => {
  const db = connection.db as TestDatabase<TRelations>
  closers.set(db, connection.close)
  return db
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
  // Some drivers resolve to a row array, others to `{ rows }`. Bun's row array
  // also carries enumerable result metadata (`count`, `command`, ...), which
  // would fail deep equality against plain arrays, so copy just the rows.
  const results: unknown = await client.execute(query)
  return Array.from(
    Array.isArray(results) ? results : (results as { rows: unknown[] }).rows,
  ) as TRow[]
}

export const closeDatabase = (client: TestDatabase<any>): Promise<void> =>
  closers.get(client)!()
