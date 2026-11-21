import type { AnyRelations, EmptyRelations } from 'drizzle-orm'
import type { PgAsyncDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'

// Every supported drizzle Postgres driver that runs against a local server or
// an embedded database. Drivers for hosted services (Neon, Vercel, Xata, AWS
// Data API, Aurora DSQL, Netlify DB) aren't covered, nor is pg-proxy: it only
// forwards queries, so its behavior depends on the user's proxy server.
// bun-sql, effect-postgres and effect-pglite are unsupported: since
// drizzle-orm 1.0.0-rc.6 they decode date/time values lossily (see
// docs/temporal.md).
export const drivers = [
  'pglite',
  'postgres-js',
  'node-postgres',
  // drizzle's own driver, `drizzle-orm/postgres`, and its Effect and PGlite
  // variants. The suite runs `postgres` under Bun too.
  'postgres',
  'postgres-effect',
  'postgres-pglite',
] as const
export type TestDriver = (typeof drivers)[number]

// Drivers that run their own embedded Postgres and ignore `DATABASE_URL`.
export const embeddedDrivers: readonly TestDriver[] = [
  'pglite',
  'postgres-pglite',
]

const resolveDriver = (): TestDriver => {
  const driver = process.env.TEST_DRIVER
  if (!driver) return process.env.DATABASE_URL ? 'postgres-js' : 'pglite'
  if (!drivers.includes(driver as TestDriver)) {
    throw new Error(
      `Unknown TEST_DRIVER "${driver}", expected one of: ${drivers.join(', ')}`,
    )
  }
  if (!embeddedDrivers.includes(driver as TestDriver)) {
    if (!process.env.DATABASE_URL) {
      throw new Error(`TEST_DRIVER=${driver} requires DATABASE_URL`)
    }
  }
  return driver as TestDriver
}

/**
 * The driver every `createDatabase()` call uses. Set with `TEST_DRIVER`;
 * defaults to postgres-js when `DATABASE_URL` is set and PGlite otherwise.
 */
export const testDriver = resolveDriver()

// The shared base type rather than a union of the driver databases: a union of
// their overloaded methods (e.g. `execute`) is not callable. The Effect
// databases don't extend it, but `makeEffectQueriesAwaitable` gives them the
// promise-based surface the tests use.
export type TestDatabase<TRelations extends AnyRelations = EmptyRelations> =
  PgAsyncDatabase<PgQueryResultHKT, TRelations>

type Connection = {
  db: unknown
  close: () => Promise<void>
}

type ConnectOptions = {
  relations: AnyRelations | undefined
  /** Server connection string without a `search_path` override. */
  url: string
  /** Schema to put first on the connection's `search_path`. */
  schema: string
}

// Each server driver holds exactly one connection: session settings the tests
// make with `SET` then apply to every later query, and `search_path` is a
// startup parameter, so it survives reconnects too. A one-connection pool
// isn't enough for drivers that replace a connection after a failed query.
export const connect = async ({
  relations,
  url,
  schema,
}: ConnectOptions): Promise<Connection> => {
  switch (testDriver) {
    case 'pglite': {
      const { PGlite } = await import('@electric-sql/pglite')
      const { drizzle } = await import('drizzle-orm/pglite')
      const client = await PGlite.create()
      return { db: drizzle({ client, relations }), close: () => client.close() }
    }

    case 'postgres-js': {
      const { default: postgres } = await import('postgres')
      const { drizzle } = await import('drizzle-orm/postgres-js')
      // postgres-js reconnects after `idle_timeout`; the pool never replaces
      // a connection after a failed query.
      const client = postgres(url, {
        idle_timeout: 1,
        max: 1,
        connection: { search_path: schema },
      })
      return { db: drizzle({ client, relations }), close: () => client.end() }
    }

    case 'node-postgres': {
      const { Client } = await import('pg')
      const { drizzle } = await import('drizzle-orm/node-postgres')
      const client = new Client({
        connectionString: url,
        options: `-c search_path=${schema}`,
      })
      await client.connect()
      return { db: drizzle({ client, relations }), close: () => client.end() }
    }

    case 'postgres': {
      const { connect } = await import('drizzle-orm/postgres/client')
      const { drizzle } = await import('drizzle-orm/postgres')
      const client = await connect({
        url,
        options: `-c search_path=${schema}`,
      })
      return { db: drizzle({ client, relations }), close: () => client.end() }
    }

    case 'postgres-effect': {
      const { ManagedRuntime } = await import('effect')
      const { createPool } = await import('drizzle-orm/postgres/client')
      const { DrizzlePostgresClient, makeWithDefaults } =
        await import('drizzle-orm/postgres/effect')
      await makeEffectQueriesAwaitable()
      const pool = createPool({
        url,
        max: 1,
        options: `-c search_path=${schema}`,
      })
      const runtime = ManagedRuntime.make(
        DrizzlePostgresClient.layerFromPool(pool),
      )
      const db = await runtime.runPromise(makeWithDefaults({ relations }))
      return {
        db,
        close: async () => {
          await runtime.dispose()
          await pool.end()
        },
      }
    }

    case 'postgres-pglite': {
      const { PGlite } = await import('@electric-sql/pglite')
      const { drizzle } = await import('drizzle-orm/postgres/pglite')
      const client = await PGlite.create()
      const db = drizzle({ connection: client, relations })
      return {
        db,
        close: async () => {
          await db.$client.end()
          await client.close()
        },
      }
    }
  }
}

let effectQueriesAwaitable: Promise<void> | undefined

/**
 * Effect drizzle queries are Effects, not promises. Running them on `await`
 * lets the promise-based suite drive the Effect drivers unchanged. A query
 * needs no services once its database exists, so `Effect.runPromise` can run
 * it.
 */
const makeEffectQueriesAwaitable = () =>
  (effectQueriesAwaitable ??= (async () => {
    const { Effect } = await import('effect')
    const queries = await import('drizzle-orm/pg-core/effect')
    function then(
      this: Parameters<typeof Effect.runPromise>[0],
      ...callbacks: Parameters<Promise<unknown>['then']>
    ) {
      return Effect.runPromise(this).then(...callbacks)
    }
    for (const Query of [
      queries.PgEffectSelectBase,
      queries.PgEffectInsertBase,
      queries.PgEffectUpdateBase,
      queries.PgEffectDeleteBase,
      queries.PgEffectRaw,
      queries.PgEffectRelationalQuery,
      queries.PgEffectCountBuilder,
      queries.PgEffectRefreshMaterializedView,
    ]) {
      // oxlint-disable-next-line unicorn/no-thenable -- the point of the shim
      Object.defineProperty(Query.prototype, 'then', { value: then })
    }
    // `.prepare()` returns a prepared query whose `execute()` yields a plain
    // Effect, which has no shared prototype to patch.
    const { execute } = queries.PgEffectPreparedQuery.prototype
    queries.PgEffectPreparedQuery.prototype.execute = function (...args) {
      // oxlint-disable-next-line unicorn/no-thenable -- see above
      return Object.defineProperty(execute.apply(this, args), 'then', {
        value: then,
      })
    }
  })())
