# Temporal Utilities

Work with PostgreSQL date/time types using the modern Temporal API.

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Installation & Setup](#installation--setup)
- [Basic Column Types](#basic-column-types)
- [Text-based Temporal Types](#text-based-temporal-types)
- [Working with Temporal Values](#working-with-temporal-values)
- [Type Safety](#type-safety)
- [API Reference](#api-reference)

## Features

- ⏰ **[Temporal API](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal) support** - Modern date/time API
- 📅 **PostgreSQL integration** - Direct mapping between Temporal types and PostgreSQL date/time types
- 🔧 **Custom column types** - Ready-to-use Drizzle column definitions
- ✅ **Type safety** - Full TypeScript support for all temporal operations
- 🛡️ **Format validation** - Built-in constraints for text-based temporal types
- ⚠️ **Compatibility** - Two options available: globally available Temporal API or via [temporal-polyfill](https://github.com/fullcalendar/temporal-polyfill) package

## Quick Start

Here's a quick example to get you started:

```typescript
import { pgTable, serial, text } from 'drizzle-orm/pg-core'
import { timestamp, timestampz, plainDate, time, interval } from '@denny-il/drizzle-pg-utils/temporal'
// For polyfill version
import { Temporal } from 'temporal-polyfill'

// Define your table with temporal columns
const events = pgTable('events', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  scheduledAt: timestamp.column('scheduled_at'),     // PlainDateTime
  createdAt: timestampz.column('created_at'),        // ZonedDateTime
  eventDate: plainDate.column('event_date'),         // PlainDate
  startTime: time.column('start_time'),              // PlainTime
  duration: interval.column('duration'),             // Duration
})

// Work with temporal values
const now = Temporal.Now.plainDateTimeISO()
const zonedNow = Temporal.Now.zonedDateTimeISO('America/New_York')
const eventDate = Temporal.PlainDate.from('2023-12-25')

// Insert data
await db.insert(events).values({
  name: 'Holiday Party',
  scheduledAt: now,
  createdAt: zonedNow,
  eventDate: eventDate,
  startTime: Temporal.PlainTime.from('14:30:00'),
  duration: Temporal.Duration.from('PT2H30M'),
})
```

## Installation & Setup

### Package Installation

```bash
npm install @denny-il/drizzle-pg-utils
```

### Import Options

```typescript
// Temporal utilities (globally registered Temporal)
import * as temporal from '@denny-il/drizzle-pg-utils/temporal'

// Temporal utilities (with polyfill)
import * as temporal from '@denny-il/drizzle-pg-utils/temporal/polyfill'
```

### Global vs Polyfill

This library provides two versions of temporal utilities:

- **Global** (`@denny-il/drizzle-pg-utils/temporal`) - Uses the globally registered Temporal when available
- **Polyfill** (`@denny-il/drizzle-pg-utils/temporal/polyfill`) - Uses the temporal-polyfill package

Choose the version that best fits your runtime environment. The polyfill version is recommended for current production use.

### Installing Dependencies

When using the polyfill version, install the temporal-polyfill dependency:

```bash
npm install temporal-polyfill
```

### Configuration Requirements

#### PostgreSQL Configuration

For `interval` columns to work correctly with `Temporal.Duration`, you must set PostgreSQL's `intervalstyle` to `'iso_8601'`:

```sql
SET intervalstyle = 'iso_8601';
```

Or configure it in your PostgreSQL configuration file for permanent effect:

```
intervalstyle = 'iso_8601'
```

#### JSON Serialization Fix

If you encounter issues with JSON serialization of `ZonedDateTime`, register the JSON fix:

```typescript
import { _registerZonedDateTimeJSONFix } from '@denny-il/drizzle-pg-utils/temporal/polyfill'
// or for global: '@denny-il/drizzle-pg-utils/temporal'

// Call once at application startup
_registerZonedDateTimeJSONFix()
```

## Basic Column Types

Define tables with Temporal types with native PostgreSQL support:

```typescript
import { pgTable, serial, text } from 'drizzle-orm/pg-core'
import { timestamp, timestampz, plainDate, time, interval } from '@denny-il/drizzle-pg-utils/temporal'

const events = pgTable('events', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  
  // timestamp - PlainDateTime (no timezone)
  scheduledAt: timestamp.column('scheduled_at'),
  scheduledAtPrecision: timestamp.column('scheduled_at_precise', { precision: 6 }),
  
  // timestamptz - ZonedDateTime (with timezone, stored as UTC)
  createdAt: timestampz.column('created_at'),
  createdAtPrecision: timestampz.column('created_at_precise', { precision: 3 }),
  
  // date - PlainDate
  eventDate: plainDate.column('event_date'),
  
  // time - PlainTime
  startTime: time.column('start_time'),
  startTimePrecision: time.column('start_time_precise', { precision: 3 }),
  
  // interval - Duration (requires PostgreSQL intervalstyle = 'iso_8601')
  duration: interval.column('duration'),
  durationFields: interval.column('duration_hm', { fields: 'hour to minute' }),
  durationPrecision: interval.column('duration_precise', { precision: 2 }),
})
```

## Text-based Temporal Types

For year-month and month-day values stored as text with optional validation:

```typescript
import { pgTable, serial } from 'drizzle-orm/pg-core'
import { yearMonth, monthDay } from '@denny-il/drizzle-pg-utils/temporal'

const reports = pgTable('reports', {
  id: serial('id').primaryKey(),
  reportMonth: yearMonth.column('report_month'),
  holidayDate: monthDay.column('holiday_date'),
}, (table) => ([
  // Add format validation constraints
  ...yearMonth.constraints(table.reportMonth),
  ...monthDay.constraints(table.holidayDate),
]))
```

## Working with Temporal Values

### Creating Temporal Values

```typescript
// For polyfill version
import { Temporal } from 'temporal-polyfill'
// For global version, Temporal is available globally

// Create temporal values
const now = Temporal.Now.plainDateTimeISO()
const zonedNow = Temporal.Now.zonedDateTimeISO('America/New_York')
const eventDate = Temporal.PlainDate.from('2023-12-25')
const startTime = Temporal.PlainTime.from('14:30:00')
const duration = Temporal.Duration.from('PT2H30M15S')
const yearMonth = Temporal.PlainYearMonth.from('2023-12')
const monthDay = Temporal.PlainMonthDay.from('12-25')
```

### Database Operations

```typescript
// Insert data
await db.insert(events).values({
  name: 'Holiday Party',
  scheduledAt: now,
  createdAt: zonedNow,
  eventDate: eventDate,
  startTime: startTime,
  duration: duration,
})

// Insert text-based temporal data
await db.insert(reports).values({
  reportMonth: yearMonth,
  holidayDate: monthDay,
})

// Query data with temporal operations
const upcomingEvents = await db
  .select()
  .from(events)
  .where(gt(events.eventDate, Temporal.Now.plainDateISO()))

// Update temporal values
await db
  .update(events)
  .set({
    scheduledAt: Temporal.Now.plainDateTimeISO().add({ hours: 1 }),
    duration: Temporal.Duration.from('PT3H')
  })
  .where(eq(events.id, 1))
```

### Working with Timezones

```typescript
// ZonedDateTime always stores as UTC in PostgreSQL
const userTimezone = 'America/Los_Angeles'
const localTime = Temporal.ZonedDateTime.from('2023-12-25T15:30:00[America/Los_Angeles]')

// Insert - automatically converted to UTC
await db.insert(events).values({
  name: 'West Coast Meeting',
  createdAt: localTime, // Stored as UTC in database
})

// Query - returns as UTC ZonedDateTime
const event = await db.select().from(events).where(eq(events.id, 1))
// Convert back to user's timezone for display
const localDisplay = event.createdAt.withTimeZone(userTimezone)
```

### Duration Calculations

```typescript
// Calculate event duration
const startTime = Temporal.PlainDateTime.from('2023-12-25T14:30:00')
const endTime = Temporal.PlainDateTime.from('2023-12-25T16:45:00')
const eventDuration = endTime.since(startTime)

await db.insert(events).values({
  name: 'Workshop',
  scheduledAt: startTime,
  duration: eventDuration, // PT2H15M
})

// Add duration to existing events
await db
  .update(events)
  .set({
    scheduledAt: sql`${events.scheduledAt} + ${Temporal.Duration.from('PT30M')}`
  })
  .where(eq(events.id, 1))
```

## Type Safety

All temporal functions provide full TypeScript support:

- **Temporal types are fully typed** - Complete TypeScript integration with proper Temporal type definitions
- **Column definitions include precise type information** - Drizzle column types accurately reflect the underlying Temporal types
- **Automatic conversion between PostgreSQL and Temporal types** - Seamless mapping with type safety preserved
- **Type-safe constraint validation** - Text-based temporal types include compile-time format validation

## API Reference

### `timestamp.column(name, config?)`

Creates a PostgreSQL `timestamp` column for `Temporal.PlainDateTime` values.

- **Parameters:**
  - `name`: Column name
  - `config?`: Optional configuration with `precision`
- **Returns:** Drizzle column definition
- **Maps to:** `timestamp[(precision)]` in PostgreSQL

### `timestampz.column(name, config?)`

Creates a PostgreSQL `timestamp with time zone` column for `Temporal.ZonedDateTime` values.

- **Parameters:**
  - `name`: Column name  
  - `config?`: Optional configuration with `precision`
- **Returns:** Drizzle column definition
- **Maps to:** `timestamp[(precision)] with time zone` in PostgreSQL
- **Note:** Values are stored as UTC and returned as UTC ZonedDateTime instances

### `plainDate.column(name)`

Creates a PostgreSQL `date` column for `Temporal.PlainDate` values.

- **Parameters:**
  - `name`: Column name
- **Returns:** Drizzle column definition
- **Maps to:** `date` in PostgreSQL

### `time.column(name, config?)`

Creates a PostgreSQL `time` column for `Temporal.PlainTime` values.

- **Parameters:**
  - `name`: Column name
  - `config?`: Optional configuration with `precision`
- **Returns:** Drizzle column definition
- **Maps to:** `time[(precision)]` in PostgreSQL

### `interval.column(name, config?)`

Creates a PostgreSQL `interval` column for `Temporal.Duration` values.

- **Parameters:**
  - `name`: Column name
  - `config?`: Optional configuration with `fields` and `precision`
    - `fields`: Interval fields restriction (e.g., `'hour to minute'`, `'day to second'`)
    - `precision`: Fractional seconds precision (0-6)
- **Returns:** Drizzle column definition
- **Maps to:** `interval[fields][(precision)]` in PostgreSQL
- **Requires:** PostgreSQL `intervalstyle` set to `'iso_8601'`

**Example:**
```typescript
// Basic interval
duration: interval.column('duration')

// Hour to minute only
hourMinutes: interval.column('duration_hm', { fields: 'hour to minute' })

// With precision
precisionDuration: interval.column('duration_p', { precision: 2 })
```

### `yearMonth.column(name)` and `yearMonth.constraints(column, name?)`

Creates a text column for `Temporal.PlainYearMonth` values with format validation.

- **Column Parameters:**
  - `name`: Column name
- **Constraints Parameters:**
  - `column`: The column to validate
  - `name?`: Optional constraint name
- **Returns:** Column definition / Array of check constraints
- **Format:** `YYYY-MM` (e.g., "2023-07")

### `monthDay.column(name)` and `monthDay.constraints(column, name?)`

Creates a text column for `Temporal.PlainMonthDay` values with format validation.

- **Column Parameters:**
  - `name`: Column name
- **Constraints Parameters:**
  - `column`: The column to validate
  - `name?`: Optional constraint name
- **Returns:** Column definition / Array of check constraints
- **Format:** `MM-DD` (e.g., "07-25")

### `_registerZonedDateTimeJSONFix()`

Patches `Temporal.ZonedDateTime.prototype.toJSON` to exclude timezone names from JSON output.

- **Parameters:** None
- **Returns:** void
- **Warning:** Modifies global prototype - call once at application startup
- **Available in:** Both global and polyfill versions
