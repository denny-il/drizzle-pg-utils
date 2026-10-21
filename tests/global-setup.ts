import { randomBytes } from 'node:crypto'
import postgres from 'postgres'
import type { TestProject } from 'vitest/node'

declare module 'vitest' {
  export interface ProvidedContext {
    testSchemaPrefix: string
  }
}

// Every schema `createDatabase()` makes in this run starts with this prefix, so
// teardown drops only this run's schemas and leaves concurrent runs against the
// same database alone.
export default function setup(project: TestProject) {
  const prefix = `dpu_test_${randomBytes(4).toString('hex')}_`
  project.provide('testSchemaPrefix', prefix)

  const url = process.env.DATABASE_URL
  if (!url) return

  return async () => {
    const client = postgres(url, { max: 1, onnotice: () => {} })
    try {
      const schemas = await client<{ nspname: string }[]>`
        select nspname from pg_namespace where starts_with(nspname, ${prefix})
      `
      for (const { nspname } of schemas) {
        await client`drop schema if exists ${client(nspname)} cascade`
      }
    } finally {
      await client.end()
    }
  }
}
