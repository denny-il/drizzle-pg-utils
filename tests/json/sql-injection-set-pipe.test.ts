import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { setPipe } from '../../src/json/index.ts'
import { jsonSetPipe } from '../../src/json/operations/set.ts'
import { createDatabase, dialect, executeQuery } from '../utils.ts'

const quotedSqlString = (value: string) => `'${value.replaceAll("'", "''")}'`

const stripSqlStringLiterals = (query: string) => {
  let stripped = ''

  for (let i = 0; i < query.length; i++) {
    if (query[i] !== "'") {
      stripped += query[i]
      continue
    }

    i++
    while (i < query.length) {
      if (query[i] === "'" && query[i + 1] === "'") {
        i += 2
        continue
      }
      if (query[i] === "'") break
      i++
    }

    stripped += "''"
  }

  return stripped
}

const expectNoExecutableInjection = (query: string) => {
  const structuralSql = stripSqlStringLiterals(query).toLowerCase()

  expect(structuralSql).not.toContain('drop table')
  expect(structuralSql).not.toContain('pg_sleep')
  expect(structuralSql).not.toContain('select 1')
}

describe('jsonSetPipe SQL injection hardening', () => {
  const baseValue = sql<Record<string, any>>`'{}'::jsonb`
  const pathOne = "profile'::text]); select pg_sleep(1); --"
  const pathTwo = "avatar\\'); drop table users; --"
  const pathThree = '0); select 1; --'
  const defaultPath = "config'); select 1; --"
  const maliciousValue = "x'); select pg_sleep(1); --"
  const maliciousDefault = "d'); drop table users; --"
  const maliciousObjectKey = "k'); drop table users; --"

  it('quotes chained malicious path segments as JSON path values', () => {
    const result = jsonSetPipe(baseValue, (setter) =>
      (setter as any)[pathOne][pathTwo][pathThree].$set('safe-value'),
    )

    const query = dialect.sqlToQuery(result)

    expect(query.params).toEqual([JSON.stringify('safe-value')])
    expect(query.sql).toContain('jsonb_set')
    expect(query.sql).toContain(
      `array[${quotedSqlString(pathOne)},${quotedSqlString(pathTwo)},${quotedSqlString(pathThree)}]::text[]`,
    )
    expectNoExecutableInjection(query.sql)
  })

  it('keeps malicious alias values and defaults in params', () => {
    const result = setPipe(baseValue, (setter) =>
      (setter as any)[defaultPath]
        .$default({ [maliciousObjectKey]: maliciousDefault })
        [maliciousObjectKey].$set(maliciousValue),
    )

    const query = dialect.sqlToQuery(result)

    expect(query.params).toEqual([
      JSON.stringify(maliciousDefault),
      JSON.stringify(maliciousValue),
    ])
    expect(query.sql).toContain(
      `jsonb_build_object(${quotedSqlString(maliciousObjectKey)}, $1::jsonb)`,
    )
    expect(query.sql).toContain(
      `jsonb_extract_path('{}'::jsonb, ${quotedSqlString(defaultPath)})`,
    )
    expect(query.sql).toContain(
      `array[${quotedSqlString(defaultPath)},${quotedSqlString(maliciousObjectKey)}]::text[]`,
    )
    expect(query.sql).not.toContain(maliciousDefault)
    expect(query.sql).not.toContain(maliciousValue)
    expectNoExecutableInjection(query.sql)
  })

  it('coerces createMissing SQLWrapper misuse to boolean before SQL generation', () => {
    const rawCreateMissing = sql.raw('true); drop table users; --')

    const setQuery = dialect.sqlToQuery(
      jsonSetPipe(baseValue, (setter) =>
        (setter as any).field.$set('safe-value', rawCreateMissing),
      ),
    )
    const defaultQuery = dialect.sqlToQuery(
      jsonSetPipe(baseValue, (setter) =>
        (setter as any).field
          .$default('safe-value', 0 as any)
          .leaf.$set('safe'),
      ),
    )

    expect(setQuery.sql).toBe(
      `jsonb_set('{}'::jsonb, array['field']::text[], $1::jsonb, true)`,
    )
    expect(setQuery.params).toEqual([JSON.stringify('safe-value')])
    expect(defaultQuery.sql).toBe(
      `jsonb_set(jsonb_set(coalesce(nullif('{}'::jsonb, 'null'::jsonb), '{}'::jsonb), array['field']::text[], coalesce(nullif(jsonb_extract_path('{}'::jsonb, 'field'), 'null'::jsonb), $1::jsonb), false), array['field','leaf']::text[], $2::jsonb, true)`,
    )
    expect(defaultQuery.params).toEqual([
      JSON.stringify('safe-value'),
      JSON.stringify('safe'),
    ])
    expect(setQuery.sql).not.toContain('drop table')
    expect(defaultQuery.sql).not.toContain('drop table')
  })

  it('keeps SQLWrapper values parameterized across multiple operations', () => {
    const wrapperValue = "wrapped'); select pg_sleep(1); --"
    const result = jsonSetPipe(
      baseValue,
      (setter) => (setter as any).bare.$set(sql`${wrapperValue}`),
      (setter) => (setter as any).expr.$set(sql`lower(${wrapperValue})`),
    )

    const query = dialect.sqlToQuery(result)

    expect(query.params).toEqual([wrapperValue, wrapperValue])
    expect(query.sql).toBe(
      "jsonb_set(jsonb_set('{}'::jsonb, array['bare']::text[], $1, true), array['expr']::text[], to_jsonb(lower($2)), true)",
    )
    expect(query.sql).not.toContain(wrapperValue)
    expectNoExecutableInjection(query.sql)
  })

  it('executes malicious paths, values, defaults, and SQLWrapper expressions as data', async () => {
    const db = await createDatabase()
    const sqlWrapperValue = "MIXED'); SELECT pg_sleep(1); --"
    const source = sql<Record<string, any>>`${JSON.stringify({
      [pathOne]: {
        [pathTwo]: {
          [pathThree]: 'old',
        },
      },
      keep: true,
    })}::jsonb`

    const result = await executeQuery(
      db,
      jsonSetPipe(
        source,
        (setter) =>
          (setter as any)[pathOne][pathTwo][pathThree].$set(maliciousValue),
        (setter) =>
          (setter as any)[defaultPath]
            .$default({ [maliciousObjectKey]: maliciousDefault })
            [maliciousObjectKey].$set('overridden'),
        (setter) =>
          (setter as any).computed.$set(sql`lower(${sqlWrapperValue})`),
      ),
    )

    expect(result).toEqual({
      [pathOne]: {
        [pathTwo]: {
          [pathThree]: maliciousValue,
        },
      },
      keep: true,
      [defaultPath]: {
        [maliciousObjectKey]: 'overridden',
      },
      computed: sqlWrapperValue.toLowerCase(),
    })
  }, 15_000)
})
