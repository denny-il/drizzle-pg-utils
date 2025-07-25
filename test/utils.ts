import { type SQLWrapper, sql } from 'drizzle-orm'
import { jsonb, PgDialect, pgTable } from 'drizzle-orm/pg-core'
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite'

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

export const createDatabase = async () => {
  const { PGlite } = await import('@electric-sql/pglite')
  const pglite = await PGlite.create({})
  return drizzle(pglite)
}

export const executeQuery = async (
  client: PgliteDatabase,
  query: SQLWrapper,
): Promise<any> => {
  const results = await client.execute(sql`select (${query}) as result`)
  return results.rows[0]!.result
}
