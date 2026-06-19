import { access } from '@denny-il/drizzle-pg-utils/json'
import { sql } from 'drizzle-orm'
import type { PgliteDatabase } from 'drizzle-orm/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { jsonAccess } from '../../src/json/operations/access.ts'
import { createDatabase, dialect, executeQuery } from '../utils.ts'

let db: PgliteDatabase

beforeAll(async () => {
  db = await createDatabase()
})

const sqlString = (value: string) => `'${value.replaceAll("'", "''")}'`

const jsonLiteral = <T>(value: T) =>
  sql<T>`${sql.raw(`${sqlString(JSON.stringify(value))}::jsonb`)}`

const emptyJson = jsonLiteral<Record<string, unknown>>({})

const hostileKeys = [
  "name'); select pg_sleep(1); --",
  "x' OR '1'='1",
  'a,b',
  'a/*comment*/b',
  'a--comment',
  "a->>'secret'",
  "a#>>'{secret}'",
  '{0,secret}',
  '"quoted"',
  'back\\slash',
  'semi;colon',
  ') from pg_catalog.pg_class --',
] as const

describe('jsonAccess SQL injection hardening', () => {
  it.each(
    hostileKeys,
  )('renders hostile key %s as one escaped path literal', (key) => {
    const accessor = jsonAccess(emptyJson) as any
    const query = dialect.sqlToQuery(accessor[key].$value)

    expect(query.params).toEqual([])
    expect(query.sql).toBe(`jsonb_extract_path('{}'::jsonb, ${sqlString(key)})`)
  })

  it('renders hostile nested keys as separate escaped path literals', () => {
    const firstKey = "safe','stolen"
    const secondKey = "leaf'); drop table users; --"
    const accessor = jsonAccess(emptyJson) as any
    const query = dialect.sqlToQuery(accessor.root[firstKey][secondKey].$text)

    expect(query.params).toEqual([])
    expect(query.sql).toBe(
      `jsonb_extract_path_text('{}'::jsonb, 'root',${sqlString(firstKey)},${sqlString(secondKey)})`,
    )
  })

  it('keeps numeric-looking object keys as exact path segments', async () => {
    const document = jsonLiteral({
      numeric: {
        '0': 'zero-key',
        '01': 'leading-zero-key',
        '-1': 'negative-key',
        '1.5': 'decimal-key',
        '1e2': 'exponent-key',
      },
      list: ['array-zero', 'array-one'],
    })
    const accessor = jsonAccess(document) as any

    await expect(executeQuery(db, accessor.numeric['0'].$text)).resolves.toBe(
      'zero-key',
    )
    await expect(executeQuery(db, accessor.numeric['01'].$text)).resolves.toBe(
      'leading-zero-key',
    )
    await expect(executeQuery(db, accessor.numeric['-1'].$text)).resolves.toBe(
      'negative-key',
    )
    await expect(executeQuery(db, accessor.numeric['1.5'].$text)).resolves.toBe(
      'decimal-key',
    )
    await expect(executeQuery(db, accessor.numeric['1e2'].$text)).resolves.toBe(
      'exponent-key',
    )
    await expect(executeQuery(db, accessor.list['0'].$text)).resolves.toBe(
      'array-zero',
    )
  })

  it('retrieves hostile keys literally instead of evaluating injected path syntax', async () => {
    const pivotKey = "safe','stolen"
    const operatorKey = "profile->>'admin'"
    const commentKey = 'settings/*hidden*/'
    const statementKey = "name'); select pg_sleep(1); --"
    const document = jsonLiteral({
      safe: { stolen: 'wrong-value' },
      [pivotKey]: 'literal-pivot',
      nested: {
        [operatorKey]: {
          [commentKey]: 'literal-nested',
        },
      },
      [statementKey]: 'literal-statement',
    })
    const accessor = jsonAccess(document) as any

    await expect(executeQuery(db, accessor[pivotKey].$text)).resolves.toBe(
      'literal-pivot',
    )
    await expect(
      executeQuery(db, accessor.nested[operatorKey][commentKey].$text),
    ).resolves.toBe('literal-nested')
    await expect(executeQuery(db, accessor[statementKey].$text)).resolves.toBe(
      'literal-statement',
    )
    await expect(
      executeQuery(db, accessor["safe','missing"].$text),
    ).resolves.toBeNull()
  })

  it('applies same escaping through public access alias', async () => {
    const key = "x' OR '1'='1"
    const document = jsonLiteral({ [key]: 'alias-hit' })
    const accessor = access(document) as any
    const query = dialect.sqlToQuery(accessor[key].$text)

    expect(query.params).toEqual([])
    expect(query.sql).toBe(
      `jsonb_extract_path_text(${sqlString(JSON.stringify({ [key]: 'alias-hit' }))}::jsonb, ${sqlString(key)})`,
    )
    await expect(executeQuery(db, accessor[key].$text)).resolves.toBe(
      'alias-hit',
    )
  })

  it('rejects symbol path segments instead of coercing them into SQL', () => {
    const accessor = jsonAccess(emptyJson) as any

    expect(() => accessor[Symbol.for('json-path')]).toThrow(
      'Symbols are not supported in JSON paths',
    )
  })
})
