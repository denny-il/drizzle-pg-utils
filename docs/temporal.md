# Temporal Utilities

Use PostgreSQL date and time columns with Temporal types instead of raw strings.

## Highlights

### Native PostgreSQL types

```typescript
const events = pgTable('events', {
  scheduledAt: timestamp.column('scheduled_at'),
  createdAt: timestampz.column('created_at'),
  eventDate: plainDate.column('event_date'),
  duration: interval.column('duration'),
})
```

### Text-backed partial dates with optional checks

```typescript
const reports = pgTable(
  'reports',
  {
    reportMonth: yearMonth.column('report_month'),
    holidayDate: monthDay.column('holiday_date'),
  },
  (table) => [
    ...yearMonth.constraints(table.reportMonth),
    ...monthDay.constraints(table.holidayDate),
  ],
)
```

### Explicit binding when you do not want globals

```typescript
import { Temporal } from 'temporal-polyfill'
import { createTimestampz } from '@denny-il/drizzle-pg-utils/temporal'

const timestampz = createTimestampz(Temporal, {
  smallestUnit: 'millisecond',
})
```

## Choose an Entrypoint

There are three ways to import Temporal helpers, depending on your runtime and preferences for global polyfills:

- `@denny-il/drizzle-pg-utils/temporal`
- `@denny-il/drizzle-pg-utils/temporal/global`
- `@denny-il/drizzle-pg-utils/temporal/polyfill`

| Import path | Use it when | Exports |
| --- | --- | --- |
| `@denny-il/drizzle-pg-utils/temporal` | You want to bind helpers yourself. | `create*` factories, shared types |
| `@denny-il/drizzle-pg-utils/temporal/global` | Your runtime already has `globalThis.Temporal`, or you install a global polyfill yourself. | Prebound helpers using `globalThis.Temporal` |
| `@denny-il/drizzle-pg-utils/temporal/polyfill` | You want helpers already bound to `temporal-polyfill` without touching globals. | Prebound helpers using `temporal-polyfill` |

All three expose the same helper shapes once bound: `.column(...)` for every type, plus `.constraints(...)` for `yearMonth` and `monthDay`.

## Quick Start

Install the package:

```bash
npm install @denny-il/drizzle-pg-utils
```

If your runtime does not provide `Temporal`, add a polyfill too:

```bash
npm install temporal-polyfill
```

This example uses the global entrypoint. If you prefer `/temporal/polyfill` or the factory entrypoint, only the imports change.

```typescript
import 'temporal-polyfill/global'
import { eq, gte } from 'drizzle-orm'
import { pgTable, serial, text } from 'drizzle-orm/pg-core'
import {
  interval,
  plainDate,
  time,
  timestamp,
  timestampz,
} from '@denny-il/drizzle-pg-utils/temporal/global'

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
  name: 'Planning session',
  scheduledAt: Temporal.PlainDateTime.from('2026-03-15T09:30:00'),
  createdAt: Temporal.Instant.from('2026-03-15T08:30:00Z'),
  eventDate: Temporal.PlainDate.from('2026-03-15'),
  startTime: Temporal.PlainTime.from('09:30:00'),
  duration: Temporal.Duration.from('PT45M'),
})

const upcoming = await db
  .select()
  .from(events)
  .where(gte(events.eventDate, Temporal.PlainDate.from('2026-03-01')))

const firstEvent = await db
  .select()
  .from(events)
  .where(eq(events.id, upcoming[0]!.id))
```

If you use `interval`, PostgreSQL must use ISO 8601 interval output:

```sql
SET intervalstyle = 'iso_8601';
```

## PostgreSQL Type Map

| Helper | Temporal value | PostgreSQL type | Notes |
| --- | --- | --- | --- |
| `timestamp` | `Temporal.PlainDateTime` | `timestamp[(precision)]` | No timezone |
| `timestampz` | `Temporal.Instant` | `timestamp[(precision)] with time zone` | Stores an absolute instant |
| `plainDate` | `Temporal.PlainDate` | `date` | Date only |
| `time` | `Temporal.PlainTime` | `time[(precision)]` | Time only |
| `interval` | `Temporal.Duration` | `interval[fields][(precision)]` | Requires `intervalstyle = 'iso_8601'` |
| `yearMonth` | `Temporal.PlainYearMonth` | `text` | Optional regex constraint |
| `monthDay` | `Temporal.PlainMonthDay` | `text` | Optional regex constraint |

## Important Behavior

### `timestampz` stores an instant

`timestampz` maps directly to `Temporal.Instant`. If you already have a `Temporal.ZonedDateTime`, convert it with `.toInstant()` before writing.

```typescript
const input = Temporal.ZonedDateTime.from('2026-03-15T09:30:00+01:00[Europe/Kyiv]')

await db.insert(events).values({ createdAt: input.toInstant() })

const [row] = await db
  .select({ createdAt: events.createdAt })
  .from(events)

row!.createdAt instanceof Temporal.Instant
// true

row!.createdAt.equals(input.toInstant())
// true
```

If you need a user-facing timezone again, convert on the application side with `.toZonedDateTimeISO(...)`.

### `interval` depends on PostgreSQL output format

`interval` columns decode with `Temporal.Duration.from(...)`, so PostgreSQL must emit ISO 8601 intervals.

```sql
SET intervalstyle = 'iso_8601';
```

You can also set it in PostgreSQL configuration for a permanent default:

```text
intervalstyle = 'iso_8601'
```

### `yearMonth` and `monthDay` are text columns

These two helpers store strings and decode them back into Temporal values.

- `yearMonth.constraints(...)` validates Temporal-compatible `YYYY-MM` and signed expanded-year strings like `+010000-01`.
- `monthDay.constraints(...)` validates Temporal-compatible `MM-DD` strings, including month-specific day bounds like `02-29` and rejecting `02-30`.
- The checks are designed to match `Temporal.PlainYearMonth.from(...)` and `Temporal.PlainMonthDay.from(...)` string parsing for ISO values.

## Factories and Serialization Defaults

Use factories when you want explicit binding or shared serialization rules.

```typescript
import { Temporal } from 'temporal-polyfill'
import {
  createInterval,
  createPlainDate,
  createTime,
  createTimestamp,
  createTimestampz,
} from '@denny-il/drizzle-pg-utils/temporal'

const plainDate = createPlainDate(Temporal)
const time = createTime(Temporal, { smallestUnit: 'millisecond' })
const timestamp = createTimestamp(Temporal, { smallestUnit: 'millisecond' })
const timestampz = createTimestampz(Temporal, { smallestUnit: 'millisecond' })
const interval = createInterval(Temporal, { smallestUnit: 'millisecond' })
```

Every `create*` helper returns the same helper shape as the prebound entrypoints.

## Query Examples

### Insert and select Temporal values

```typescript
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

Selected values decode back to Temporal instances.

### Filter with Temporal values

```typescript
import { gte } from 'drizzle-orm'

const upcoming = await db
  .select({ eventDate: events.eventDate })
  .from(events)
  .where(gte(events.eventDate, Temporal.PlainDate.from('2023-06-01')))
```

### Insert SQL expressions into Temporal columns

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

### Use partial-date constraints in table definitions

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

## Minimal Reference

### Prebound helpers

- `interval.column(name, config?)`
- `monthDay.column(name)` and `monthDay.constraints(column, name?)`
- `plainDate.column(name)`
- `time.column(name, config?)`
- `timestamp.column(name, config?)`
- `timestampz.column(name, config?)`
- `yearMonth.column(name)` and `yearMonth.constraints(column, name?)`

### Factory exports

- `createInterval(Temporal, options?)`
- `createMonthDay(Temporal, options?)`
- `createPlainDate(Temporal, options?)`
- `createTime(Temporal, options?)`
- `createTimestamp(Temporal, options?)`
- `createTimestampz(Temporal, options?)`
- `createYearMonth(Temporal, options?)`
