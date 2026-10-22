# Temporal Helpers Reference

## Entrypoints

| Import path                                    | Use when                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------ |
| `@denny-il/drizzle-pg-utils/temporal`          | Consumer wants explicit `create*` factories                              |
| `@denny-il/drizzle-pg-utils/temporal/global`   | Consumer has `globalThis.Temporal` or imports `temporal-polyfill/global` |
| `@denny-il/drizzle-pg-utils/temporal/polyfill` | Consumer wants helpers bound to `temporal-polyfill` without globals      |

## Column Map

| Helper       | Temporal value            | PostgreSQL type                         |
| ------------ | ------------------------- | --------------------------------------- |
| `timestamp`  | `Temporal.PlainDateTime`  | `timestamp[(precision)]`                |
| `timestampz` | `Temporal.Instant`        | `timestamp[(precision)] with time zone` |
| `plainDate`  | `Temporal.PlainDate`      | `date`                                  |
| `time`       | `Temporal.PlainTime`      | `time[(precision)]`                     |
| `interval`   | `Temporal.Duration`       | `interval[fields][(precision)]`         |
| `yearMonth`  | `Temporal.PlainYearMonth` | `text`                                  |
| `monthDay`   | `Temporal.PlainMonthDay`  | `text`                                  |

## Basic Example

```typescript
import 'temporal-polyfill/global'
import {
  interval,
  plainDate,
  time,
  timestamp,
  timestampz,
} from '@denny-il/drizzle-pg-utils/temporal/global'
import { pgTable, serial, text } from 'drizzle-orm/pg-core'

const events = pgTable('events', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  scheduledAt: timestamp.column('scheduled_at'),
  createdAt: timestampz.column('created_at'),
  eventDate: plainDate.column('event_date'),
  startTime: time.column('start_time'),
  duration: interval.column('duration'),
})

await db.insert(events).values({
  eventDate: Temporal.PlainDate.from('2023-07-25'),
  startTime: Temporal.PlainTime.from('14:30:45.123'),
  scheduledAt: Temporal.PlainDateTime.from('2023-07-25T14:30:45.123456'),
  createdAt: Temporal.Instant.from('2023-07-25T18:30:45.123Z'),
  duration: Temporal.Duration.from('PT2H30M15S'),
})

const [event] = await db
  .select({
    eventDate: events.eventDate,
    startTime: events.startTime,
    scheduledAt: events.scheduledAt,
    createdAt: events.createdAt,
    duration: events.duration,
  })
  .from(events)
  .limit(1)
```

## Factories

```typescript
import {
  createInterval,
  createMonthDay,
  createPlainDate,
  createTime,
  createTimestamp,
  createTimestampz,
  createYearMonth,
} from '@denny-il/drizzle-pg-utils/temporal'
import { Temporal } from 'temporal-polyfill'

const plainDate = createPlainDate(Temporal)
const yearMonth = createYearMonth(Temporal)
const monthDay = createMonthDay(Temporal)
const time = createTime(Temporal, { smallestUnit: 'millisecond' })
const timestamp = createTimestamp(Temporal, { smallestUnit: 'millisecond' })
const timestampz = createTimestampz(Temporal, { smallestUnit: 'millisecond' })
const interval = createInterval(Temporal, { smallestUnit: 'millisecond' })
```

## Important Behavior

`timestampz` maps to `Temporal.Instant`. Convert `Temporal.ZonedDateTime` with `.toInstant()` before writing.

Temporal columns decode to Temporal instances in normal selects and Drizzle relational query builder results, including nested `one` and `many` relations.

`interval` requires PostgreSQL ISO 8601 interval output:

```sql
SET intervalstyle = 'iso_8601';
```

`SET` only affects the current connection. With a pool, recommend a startup parameter or a database/role default instead; see [Driver Notes](#driver-notes).

`yearMonth.constraints(column, name?)` and `monthDay.constraints(column, name?)` add optional Temporal-compatible format checks for their text columns.

- `yearMonth` accepts `YYYY-MM` and signed expanded-year strings like `+010000-01`, within Temporal's supported range.
- `monthDay` accepts zero-padded `MM-DD` strings with month-specific day bounds, including `02-29` and rejecting values like `02-30`.

```typescript
const reports = pgTable(
  'reports',
  {
    id: serial('id').primaryKey(),
    reportMonth: yearMonth.column('report_month'),
    holidayDate: monthDay.column('holiday_date'),
  },
  (table) => ({
    ...yearMonth.constraints(table.reportMonth),
    ...monthDay.constraints(table.holidayDate),
  }),
)
```

Pass a second argument to override the generated constraint name:

```typescript
yearMonth.constraints(table.reportMonth, 'reports_report_month_format')
monthDay.constraints(table.holidayDate, 'reports_holiday_date_format')
```

## Query Patterns

### Filter with Temporal values

```typescript
import { gte } from 'drizzle-orm'

const upcoming = await db
  .select({ eventDate: events.eventDate })
  .from(events)
  .where(gte(events.eventDate, Temporal.PlainDate.from('2023-06-01')))
```

### Insert SQL expressions

```typescript
import { sql } from 'drizzle-orm'

await db.insert(events).values({
  eventDate: sql`DATE '2023-07-25'`,
  startTime: sql`TIME '14:30:45.123'`,
  scheduledAt: sql`TIMESTAMP '2023-07-25 14:30:45.123456'`,
  createdAt: sql`TIMESTAMP WITH TIME ZONE '2023-07-25 14:30:45.123-04'`,
  duration: sql`INTERVAL '2 hours 30 minutes 15 seconds'`,
})
```

## Driver Notes

Tested drivers: PGlite, postgres-js, node-postgres, `drizzle-orm/postgres` (minipg), bun-sql, effect-postgres, effect-pglite.

Set `intervalstyle` per connection. Pools keep other connections on the server default, postgres-js reconnects after `idle_timeout`, and drizzle's node-postgres session discards a pooled connection after a failed query, so a one-off `SET` gets lost:

```typescript
new Pool({ connectionString, options: '-c intervalstyle=iso_8601' }) // node-postgres
postgres(url, { connection: { intervalstyle: 'iso_8601' } }) // postgres-js
createPool({ url, options: '-c intervalstyle=iso_8601' }) // minipg
new SQL({ url, connection: { intervalstyle: 'iso_8601' } }) // bun-sql
PgClient.layer({
  url: Redacted.make(url), // Redacted from 'effect'
  startupParameters: { intervalstyle: 'iso_8601' },
}) // effect-postgres
```

```sql
ALTER DATABASE app SET intervalstyle = 'iso_8601';
```

`db.execute(...)` results and untyped `sql` selections aren't decoded by Temporal columns; drivers return strings or `Date` objects there. Decode expressions with `.mapWith(column)`:

```typescript
db.select({ now: sql`now()`.mapWith(events.createdAt) }).from(events)
```

Known limitations:

- postgres-js with drizzle-orm 1.0.0-rc.5: SQL `NULL` elements in Temporal arrays are read as `'NULL'`, so decoding throws.
- effect-postgres with @effect/sql-pg 4.0: multidimensional array columns fail to decode and break the connection; `plainDate` values with negative ISO years fail to decode (`-0001-03-04` instead of `0002-03-04 BC`).
- pg-proxy is untested; decoding depends on the proxy server returning PostgreSQL text output for date and time types.
