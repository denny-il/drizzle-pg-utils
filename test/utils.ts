import { type SQLWrapper, sql } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite'

export const dialect = new PgDialect()

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
