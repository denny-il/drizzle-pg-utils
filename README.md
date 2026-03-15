# Drizzle PostgreSQL Utils

A TypeScript library providing type-safe utilities for working with PostgreSQL JSONB data and Temporal types in Drizzle ORM applications.


## Quick Start

### Installation

```bash
npm install @denny-il/drizzle-pg-utils
```

### Query Example (Select + Update)

```typescript
import { sql, eq } from 'drizzle-orm'
import { jsonb, pgTable, serial, text } from 'drizzle-orm/pg-core'
import json from '@denny-il/drizzle-pg-utils/json'

type Profile = {
  user: {
    name: string
    preferences?: { theme: 'light' | 'dark'; tags?: string[] }
  }
}

const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').notNull(),
  profile: jsonb('profile').$type<Profile>().notNull(),
})

const profile = json.access(users.profile)

const [row] = await db
  .select({
    id: users.id,
    // This now works without having any runtime schemas, 
    // and is fully type-safe
    theme: profile.user.preferences.theme.$value,
  })
  .from(users)
  .where(eq(profile.user.preferences.theme.$value, 'dark'))

await db
  .update(users)
  .set({
    // Update specific paths in JSONB column atomically in a single query,
    // without merging the entire object in application code.
    profile: json.setPipe(
      users.profile,
      // Set theme to 'dark'.
      (s) => s.user.preferences.theme.$set('dark'),
      // Set first value in tags array to 'intro'.
      (s) => s.user.preferences.tags['0'].$set('intro'),
    ),
  })
  .where(eq(users.id, row!.id))
```

## Features

### JSON Utilities
- 🎯 **Type-safe JSONB operations** - Full TypeScript support with proper type inference
- 🔍 **JSON accessor** - Navigate nested JSON structures with dot notation WITHOUT any runtime schema
- ✏️ **JSON setter** - Update JSON values at specific paths with default value support for optional properties
- 🔄 **JSON merge** - Merge JSON objects and arrays following PostgreSQL semantics
- 📦 **Array operations** - Push, set, and delete array elements
- 🛡️ **Null safety** - Proper handling of SQL NULL and JSON null values
- ⚠️ **Compatibility** - Requires runtime with [Proxy](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy#browser_compatibility) support

```typescript
import json from '@denny-il/drizzle-pg-utils/json'

// Access nested properties with type safety
const accessor = json.access(users.profile)
const theme = accessor.user.preferences.theme.$value

// Update values at specific paths
const setter = json.set(users.profile)
const updated = setter.user.name.$set('New Name')
```

### Temporal Utilities
- ⏰ **[Temporal API](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal) support** - Modern date/time API
- 📅 **PostgreSQL integration** - Direct mapping between Temporal types and PostgreSQL date/time types
- 🔧 **Custom column types** - Ready-to-use Drizzle column definitions
- ✅ **Type safety** - Full TypeScript support for all temporal operations
- 🛡️ **Format validation** - Built-in constraints for text-based temporal types
- ⚠️ **Compatibility** - Choose prebound helpers from `/temporal/global` or `/temporal/polyfill`, or bind your own implementation with the exported `create*` factories

```typescript
import { timestamp, timestampz } from '@denny-il/drizzle-pg-utils/temporal/global'

const events = pgTable('events', {
  id: serial('id').primaryKey(),
  scheduledAt: timestamp.column('scheduled_at'),
  createdAt: timestampz.column('created_at'),
})
```

If you do not want to rely on a global `Temporal`, import your implementation yourself and create bound helpers:

```typescript
import { Temporal } from 'temporal-polyfill'
import { createInterval, createTimestampz } from '@denny-il/drizzle-pg-utils/temporal'

const interval = createInterval(Temporal)
const timestampz = createTimestampz(Temporal)
```

## Documentation

- **[JSON Utilities](./doc/json.md)** - Complete guide to JSON operations
- **[Temporal Utilities](./doc/temporal.md)** - Working with PostgreSQL date/time types using Temporal API

## License

MIT License - see [LICENSE.md](LICENSE.md) for details.
