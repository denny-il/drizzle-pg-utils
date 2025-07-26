# Drizzle PostgreSQL Utils

A TypeScript library providing type-safe utilities for working with PostgreSQL JSONB data and Temporal types in Drizzle ORM applications.

## Features

### JSON Utilities
- 🎯 **Type-safe JSONB operations** - Full TypeScript support with proper type inference
- 🔍 **JSON accessor** - Navigate nested JSON structures with dot notation WITHOUT any runtime schema
- ✏️ **JSON setter** - Update JSON values at specific paths
- 🔄 **JSON merge** - Merge JSON objects and arrays following PostgreSQL semantics
- 📦 **Array operations** - Push, set, and delete array elements
- 🛡️ **Null safety** - Proper handling of SQL NULL and JSON null values
- ⚠️ **Compatibility** - Requires runtime with [Proxy](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy#browser_compatibility) support

### Temporal Utilities
- ⏰ **Temporal API support** - Modern date/time handling with Temporal polyfill
- 📅 **PostgreSQL integration** - Direct mapping between Temporal types and PostgreSQL date/time types
- 🔧 **Custom column types** - Ready-to-use Drizzle column definitions
- ✅ **Type safety** - Full TypeScript support for all temporal operations
- 🛡️ **Format validation** - Built-in constraints for text-based temporal types
- ⚠️ **Compatibility** - Uses [temporal-polyfill](https://github.com/fullcalendar/temporal-polyfill), since not yet supported natively pretty much anywhere

## Installation

```bash
npm install @denny-il/drizzle-pg-utils
# or
pnpm add @denny-il/drizzle-pg-utils
# or
yarn add @denny-il/drizzle-pg-utils
```

## Exports Structure

This library provides modular exports for different functionality:

```typescript
// Main export - includes all utilities
import { json, temporal } from '@denny-il/drizzle-pg-utils'

// JSON utilities only
import { access, merge, array, setPipe } from '@denny-il/drizzle-pg-utils/json'
// or
import json from '@denny-il/drizzle-pg-utils/json'

// Temporal utilities only
import { timestamp, timestampz, date } from '@denny-il/drizzle-pg-utils/temporal'
// or
import temporal from '@denny-il/drizzle-pg-utils/temporal'
```

Each export is independently importable, allowing you to include only what you need in your bundle.

## Usage

### JSON Accessor

Access nested properties in JSONB columns with type safety:

```typescript
import { sql } from 'drizzle-orm'
import json from '@denny-il/drizzle-pg-utils/json'

// Define your JSON type
type UserProfile = {
  user: {
    id: number
    name: string
    profile: {
      avatar: string
      preferences: {
        theme: 'light' | 'dark'
        notifications: boolean
      }
    }
  }
  tags: string[]
}

const jsonData = sql<UserProfile>`'{"user": {"id": 1, "name": "John", "profile": {"avatar": "url", "preferences": {"theme": "dark", "notifications": true}}}, "tags": ["tag1", "tag2"]}'::jsonb`

// Access nested properties
const accessor = json.access(jsonData)

// Get the user's name
const userName = accessor.user.name.$value  // Returns value as string (jsonb_extract_path_text, or '->> operator)
const userPath = accessor.user.name.$path   // Returns value as jsonb (jsonb_extract_path, or '-> operator)

// Access deeply nested values
const theme = accessor.user.profile.preferences.theme.$value
const notifications = accessor.user.profile.preferences.notifications.$value

// Access arrays
const tags = accessor.tags.$value
```

### JSON Setter

Update specific paths in JSONB data:

```typescript
import { sql } from 'drizzle-orm'
import json from '@denny-il/drizzle-pg-utils/json'

const jsonData = sql<UserProfile>`'{"user": {"id": 1, "name": "John"}}'::jsonb`
const setter = json.set(jsonData)

// Set a simple value
const updatedName = setter.user.name.$set('Jane')

// Set a complex object
const updatedProfile = setter.user.profile.$set({
  avatar: 'new-avatar.jpg',
  preferences: {
    theme: 'light',
    notifications: false
  }
})

// Set with createMissing parameter (default: true)
const setWithoutCreating = setter.user.newField.$set('value', false)
```

### JSON Set Pipe

Chain multiple JSONB set operations together for complex updates:

```typescript
import { sql } from 'drizzle-orm'
import { jsonSetPipe } from '@denny-il/drizzle-pg-utils/json'

const userData = sql<UserProfile>`'{"user": {"id": 1, "name": "John"}}'::jsonb`

// Chain multiple updates together
const updated = jsonSetPipe(
  userData,
  // First update: set the user name
  (setter) => setter.user.name.$set('Jane'),
  // Second update: add profile data (operates on result of first update)
  (setter) => setter.user.profile.$set({
    avatar: 'avatar.jpg',
    preferences: { theme: 'dark', notifications: true }
  }),
  // Third update: set last login (operates on result of second update)
  (setter) => setter.lastLogin.$set('2023-12-01T10:00:00Z')
)
// Result: Complete UserProfile object with all updates applied sequentially

// Use with database updates for complex multi-field changes
await db
  .update(users)
  .set({
    profile: jsonSetPipe(
      users.profile,
      (setter) => setter.user.name.$set('Updated Name'),
      (setter) => setter.user.profile.preferences.theme.$set('light'),
      (setter) => setter.lastLogin.$set(new Date().toISOString())
    )
  })
  .where(eq(users.id, 1))
```

### JSON Merge

Merge JSON objects and arrays following PostgreSQL JSONB semantics:

```typescript
import { sql } from 'drizzle-orm'
import json from '@denny-il/drizzle-pg-utils/json'

const obj1 = sql`'{"a": "hello", "b": 1}'::jsonb`
const obj2 = sql`'{"b": 2, "c": true}'::jsonb`

// Merge objects (right takes precedence on duplicate keys)
const merged = json.merge(obj1, obj2)
// Result: {"a": "hello", "b": 2, "c": true}

// Merge arrays
const arr1 = sql`'[1, 2]'::jsonb`
const arr2 = sql`'[3, 4]'::jsonb`
const mergedArray = json.merge(arr1, arr2)
// Result: [1, 2, 3, 4]

// Mix types (creates arrays)
const mixed = json.merge(sql`'"hello"'::jsonb`, arr1)
// Result: ["hello", 1, 2]
```

### Array Operations

Manipulate JSONB arrays:

```typescript
import { sql } from 'drizzle-orm'
import json from '@denny-il/drizzle-pg-utils/json'

const numberArray = sql<number[]>`'[1, 2, 3]'::jsonb`

// Push values to array
const withPushed = json.array.push(numberArray, 4, 5)
// Result: [1, 2, 3, 4, 5]

// Set value at specific index
const withSet = json.array.set(numberArray, 1, 99)
// Result: [1, 99, 3]

// Delete element at index
const withDeleted = json.array.delete(numberArray, 0)
// Result: [2, 3]
```

### Working with Database Columns

Use with actual Drizzle table columns:

```typescript
import { jsonb, pgTable, serial, text } from 'drizzle-orm/pg-core'
import json from '@denny-il/drizzle-pg-utils/json'

const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  profile: jsonb('profile').$type<UserProfile>()
})

// In your queries
const user = await db
  .select({
    id: users.id,
    name: users.name,
    theme: json.access(users.profile).user.profile.preferences.theme.$value
  })
  .from(users)
  .where(eq(users.id, 1))

// Update queries
await db
  .update(users)
  .set({
    profile: json.set(users.profile).user.name.$set('New Name')
  })
  .where(eq(users.id, 1))

// Merge updates
await db
  .update(users)
  .set({
    profile: json.merge(
      users.profile,
      sql`'{"user": {"lastLogin": "2023-12-01"}}'::jsonb`
    )
  })
  .where(eq(users.id, 1))
```

## Temporal API Integration

Work with PostgreSQL date/time types using the modern Temporal API.

### Setup

In case you encounter issues with JSON serialization of `ZonedDateTime`, register the JSON fix that excludes timezone names:

```typescript
import { _registerZonedDateTimeJSONFix } from '@denny-il/drizzle-pg-utils/temporal'

// Call once at application startup in case
_registerZonedDateTimeJSONFix()
```

### Basic Column Types

Define tables with Temporal types with native PostgreSQL support:

```typescript
import { pgTable, serial, text } from 'drizzle-orm/pg-core'
import { timestamp, timestampz, date, time, interval } from '@denny-il/drizzle-pg-utils/temporal'

const events = pgTable('events', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  
  // timestamp - PlainDateTime (no timezone)
  scheduledAt: timestamp.column('scheduled_at'),
  
  // timestamptz - ZonedDateTime (with timezone, stored as UTC)
  createdAt: timestampz.column('created_at'),
  
  // date - PlainDate
  eventDate: date.column('event_date'),
  
  // time - PlainTime
  startTime: time.column('start_time', { precision: 3 }),
  
  // interval - Duration (requires PostgreSQL intervalstyle = 'iso_8601')
  duration: interval.column('duration'),
})
```

### Text-based Temporal Types

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

### Working with Temporal Values

```typescript
import { Temporal } from 'temporal-polyfill'

// Insert data
const now = Temporal.Now.plainDateTimeISO()
const zonedNow = Temporal.Now.zonedDateTimeISO('America/New_York')
const eventDate = Temporal.PlainDate.from('2023-12-25')
const duration = Temporal.Duration.from('PT2H30M')

await db.insert(events).values({
  name: 'Holiday Party',
  scheduledAt: now,
  createdAt: zonedNow,
  eventDate: eventDate,
  duration: duration,
})
```


## API Reference

### JSON Utilities

#### `json.access(source)`

Creates a type-safe accessor for navigating JSONB structures.

- **Parameters:**
  - `source`: JSONB column or SQL expression
- **Returns:** Proxy object with type-safe property access
- **Properties:**
  - `.$value`: Extract the value as `text` (using `jsonb_extract_path_text`, equivalent to `->>` operator)
  - `.$path`: Extract the value as `jsonb` (using `jsonb_extract_path`, equivalent to `->` operator)

#### `json.set(source)`

Creates a setter for updating JSONB values at specific paths.

- **Parameters:**
  - `source`: JSONB column or SQL expression
- **Returns:** Proxy object with `$set` methods
- **Method:**
  - `.$set(value, createMissing?)`: Update the value at this path

#### `json.setPipe(source, ...operations)`

Chains multiple JSONB set operations together in a pipeline.

- **Parameters:**
  - `source`: Initial JSONB column or SQL expression
  - `operations`: Functions that take a setter and return SQL expressions with updates
- **Returns:** SQL expression with all updates applied sequentially
- **Usage:** Each operation receives the result of the previous operation, allowing for complex multi-step updates in a single expression

#### `json.merge(left, right)`

Merges two JSONB values following PostgreSQL semantics.

- **Parameters:**
  - `left`: First JSONB value
  - `right`: Second JSONB value
- **Returns:** SQL expression with merged result

#### `json.array.push(source, ...values)`

Appends values to a JSONB array.

- **Parameters:**
  - `source`: JSONB array
  - `values`: Values to append
- **Returns:** SQL expression with updated array

#### `json.array.set(source, index, value)`

Sets a value at a specific array index.

- **Parameters:**
  - `source`: JSONB array
  - `index`: Zero-based index
  - `value`: New value
- **Returns:** SQL expression with updated array

#### `json.array.delete(source, index)`

Removes an element at a specific array index.

- **Parameters:**
  - `source`: JSONB array
  - `index`: Zero-based index to remove
- **Returns:** SQL expression with updated array

### Temporal Utilities

#### `timestamp.column(name, config?)`

Creates a PostgreSQL `timestamp` column for `Temporal.PlainDateTime` values.

- **Parameters:**
  - `name`: Column name
  - `config?`: Optional configuration with `precision`
- **Returns:** Drizzle column definition
- **Maps to:** `timestamp[(precision)]` in PostgreSQL

#### `timestampz.column(name, config?)`

Creates a PostgreSQL `timestamp with time zone` column for `Temporal.ZonedDateTime` values.

- **Parameters:**
  - `name`: Column name  
  - `config?`: Optional configuration with `precision`
- **Returns:** Drizzle column definition
- **Maps to:** `timestamp[(precision)] with time zone` in PostgreSQL
- **Note:** Values are stored as UTC and returned as UTC ZonedDateTime instances

#### `date.column(name)`

Creates a PostgreSQL `date` column for `Temporal.PlainDate` values.

- **Parameters:**
  - `name`: Column name
- **Returns:** Drizzle column definition
- **Maps to:** `date` in PostgreSQL

#### `time.column(name, config?)`

Creates a PostgreSQL `time` column for `Temporal.PlainTime` values.

- **Parameters:**
  - `name`: Column name
  - `config?`: Optional configuration with `precision`
- **Returns:** Drizzle column definition
- **Maps to:** `time[(precision)]` in PostgreSQL

#### `interval.column(name, config?)`

Creates a PostgreSQL `interval` column for `Temporal.Duration` values.

- **Parameters:**
  - `name`: Column name
  - `config?`: Optional configuration with `fields` and `precision`
- **Returns:** Drizzle column definition
- **Maps to:** `interval[fields][(precision)]` in PostgreSQL
- **Requires:** PostgreSQL `intervalstyle` set to `'iso_8601', see [PostgreSQL documentation](https://www.postgresql.org/docs/current/datatype-datetime.html#DATATYPE-INTERVAL-OUTPUT)`

#### `yearMonth.column(name)` and `yearMonth.constraints(column, name?)`

Creates a text column for `Temporal.PlainYearMonth` values with format validation.

- **Column Parameters:**
  - `name`: Column name
- **Constraints Parameters:**
  - `column`: The column to validate
  - `name?`: Optional constraint name
- **Returns:** Column definition / Array of check constraints
- **Format:** `YYYY-MM` (e.g., "2023-07")

#### `monthDay.column(name)` and `monthDay.constraints(column, name?)`

Creates a text column for `Temporal.PlainMonthDay` values with format validation.

- **Column Parameters:**
  - `name`: Column name
- **Constraints Parameters:**
  - `column`: The column to validate
  - `name?`: Optional constraint name
- **Returns:** Column definition / Array of check constraints
- **Format:** `MM-DD` (e.g., "07-25")

#### `_registerZonedDateTimeJSONFix()`

Patches `Temporal.ZonedDateTime.prototype.toJSON` to exclude timezone names from JSON output.

- **Parameters:** None
- **Returns:** void
- **Warning:** Modifies global prototype - call once at application startup

## Type Safety

All functions provide full TypeScript support:

### JSON Utilities
- Input types are validated at compile time
- Return types are properly inferred based on the input JSON schema
- Nested property access maintains type safety
- SQL NULL vs JSON null handling is type-aware

### Temporal Utilities
- Temporal types are fully typed with proper TypeScript integration
- Column definitions include precise type information
- Automatic conversion between PostgreSQL and Temporal types
- Type-safe constraint validation for text-based temporal types

## PostgreSQL Compatibility

This library targets PostgreSQL 12+ and uses standard functions:

### JSON Operations
- `jsonb_extract_path()` and `jsonb_extract_path_text()` for access
- `jsonb_set()` for updates
- `||` operator for merging
- `jsonb_build_array()` and `jsonb_build_object()` for construction

### Temporal Operations
- Native PostgreSQL date/time types: `timestamp`, `timestamptz`, `date`, `time`, `interval`
- ISO 8601 format support for intervals (requires `intervalstyle = 'iso_8601'` set in PostgreSQL)
- Text-based storage with regex validation for `yearMonth` and `monthDay` types
- Full timezone support with automatic UTC conversion

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for your changes
4. Run the test suite: `pnpm test`
5. Submit a pull request

## License

MIT License - see LICENSE.md for details