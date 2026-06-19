import { defineRelations, sql } from 'drizzle-orm'
import { integer, pgTable, serial, text } from 'drizzle-orm/pg-core'
import { Temporal, Temporal as TemporalImpl } from 'temporal-polyfill'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  plainDate,
  timestamp,
  timestampz,
} from '../../src/temporal/polyfill.ts'
import { createDatabase, type TestDatabase } from '../utils.ts'

const temporalUsersTable = pgTable('temporal_rqb_users', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
})

const temporalEventsTable = pgTable('temporal_rqb_events', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => temporalUsersTable.id),
  eventDate: plainDate.column('event_date'),
  eventTimestamp: timestamp.column('event_timestamp'),
  eventTimestampz: timestampz.column('event_timestampz'),
})

const temporalRqbRelations = defineRelations(
  {
    temporalEventsTable,
    temporalUsersTable,
  },
  (r) => ({
    temporalEventsTable: {
      user: r.one.temporalUsersTable({
        from: r.temporalEventsTable.userId,
        to: r.temporalUsersTable.id,
      }),
    },
    temporalUsersTable: {
      events: r.many.temporalEventsTable({
        from: r.temporalUsersTable.id,
        to: r.temporalEventsTable.userId,
      }),
    },
  }),
)

let db: TestDatabase<typeof temporalRqbRelations>

beforeAll(async () => {
  db = await createDatabase({ relations: temporalRqbRelations })

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS temporal_rqb_users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL
    )
  `)

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS temporal_rqb_events (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES temporal_rqb_users(id),
      event_date DATE,
      event_timestamp TIMESTAMP,
      event_timestampz TIMESTAMP WITH TIME ZONE
    )
  `)
})

beforeEach(async () => {
  await db.delete(temporalEventsTable)
  await db.delete(temporalUsersTable)
})

describe('Temporal RQB column types', () => {
  it('maps temporal columns from nested many relation JSON', async () => {
    const [user] = await db
      .insert(temporalUsersTable)
      .values({ name: 'Ada' })
      .returning()

    await db.insert(temporalEventsTable).values({
      eventDate: TemporalImpl.PlainDate.from('2026-05-07'),
      eventTimestamp: TemporalImpl.PlainDateTime.from('2026-05-07T10:15:30'),
      eventTimestampz: TemporalImpl.Instant.from('2026-05-07T03:15:30Z'),
      userId: user!.id,
    })

    const [result] = await db.query.temporalUsersTable.findMany({
      with: {
        events: true,
      },
    })

    const event = result!.events[0]!
    expect(event.eventDate).toBeInstanceOf(Temporal.PlainDate)
    expect(event.eventDate!.toString()).toBe('2026-05-07')
    expect(event.eventTimestamp).toBeInstanceOf(Temporal.PlainDateTime)
    expect(event.eventTimestamp!.toString()).toBe('2026-05-07T10:15:30')
    expect(event.eventTimestampz).toBeInstanceOf(Temporal.Instant)
    expect(event.eventTimestampz!.toString()).toBe('2026-05-07T03:15:30Z')
  })

  it('maps temporal columns from nested one relation JSON', async () => {
    const [user] = await db
      .insert(temporalUsersTable)
      .values({ name: 'Grace' })
      .returning()

    await db.insert(temporalEventsTable).values({
      eventDate: TemporalImpl.PlainDate.from('2026-06-08'),
      eventTimestamp: TemporalImpl.PlainDateTime.from('2026-06-08T11:16:31'),
      eventTimestampz: TemporalImpl.Instant.from('2026-06-08T04:16:31Z'),
      userId: user!.id,
    })

    const [result] = await db.query.temporalEventsTable.findMany({
      with: {
        user: true,
      },
    })

    expect(result!.eventDate).toBeInstanceOf(Temporal.PlainDate)
    expect(result!.eventDate!.toString()).toBe('2026-06-08')
    expect(result!.eventTimestamp).toBeInstanceOf(Temporal.PlainDateTime)
    expect(result!.eventTimestamp!.toString()).toBe('2026-06-08T11:16:31')
    expect(result!.eventTimestampz).toBeInstanceOf(Temporal.Instant)
    expect(result!.eventTimestampz!.toString()).toBe('2026-06-08T04:16:31Z')
    expect(result!.user!.name).toBe('Grace')
  })
})
