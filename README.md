# Drizzle PostgreSQL Utils

A TypeScript library providing type-safe utilities for working with PostgreSQL JSONB data and Temporal types in Drizzle ORM applications.


## Quick Start

### Installation

```bash
npm install @denny-il/drizzle-pg-utils
```

### Query Example (Select + Update)

```typescript
import { eq, gte } from 'drizzle-orm'
import { jsonb, pgTable, serial, text } from 'drizzle-orm/pg-core'
import { json } from '@denny-il/drizzle-pg-utils'

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
      // Initialize the optional branch before writing inside it.
      (s) => s.user.preferences.$default({ theme: 'light', tags: [] }),
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
- Access nested JSONB paths with full TypeScript inference and no runtime schema.
- Query JSONB containment with typed path traversal and full-column index-friendly SQL.
- Update deep branches atomically with `set(...)` and `setPipe(...)`.
- Build, merge, coalesce, and modify arrays with typed SQL helpers.

```typescript
import { eq } from 'drizzle-orm'
import { json } from '@denny-il/drizzle-pg-utils'

// Access nested properties with type safety
const accessor = json.access(users.profile)
const rows = await db
  .select({
    id: users.id,
    theme: accessor.user.preferences.theme.$value,
  })
  .from(users)
  .where(eq(accessor.user.preferences.theme.$value, 'dark'))

// Query JSONB containment while keeping the predicate rooted at users.profile
const darkUsers = await db
  .select({ id: users.id })
  .from(users)
  .where(
    json
      .contains(users.profile)
      .user.preferences.$contains({ theme: 'dark' }),
  )

// Update values at specific paths
await db
  .update(users)
  .set({
    profile: json.set(users.profile).user.name.$set('New Name'),
  })
  .where(eq(users.id, rows[0]!.id))
```

### Temporal Utilities
- Map PostgreSQL date and time columns directly to Temporal values.
- Choose any of the three equal entrypoints: `/temporal`, `/temporal/global`, or `/temporal/polyfill`.
- Add optional database constraints for `yearMonth` and `monthDay` text columns.

```typescript
import { timestamp, timestampz } from '@denny-il/drizzle-pg-utils/temporal/global'

const events = pgTable('events', {
  id: serial('id').primaryKey(),
  scheduledAt: timestamp.column('scheduled_at'),
  createdAt: timestampz.column('created_at'),
})

await db.insert(events).values({
  scheduledAt: Temporal.PlainDateTime.from('2026-03-15T09:30:00'),
  createdAt: Temporal.Instant.from('2026-03-15T08:30:00Z'),
})

const upcoming = await db
  .select({ scheduledAt: events.scheduledAt })
  .from(events)
  .where(
    gte(
      events.scheduledAt,
      Temporal.PlainDateTime.from('2026-03-01T00:00:00'),
    ),
  )
```

See `docs/temporal.md` for setup choices, runtime behavior, and examples.

## Documentation

- **[JSON Utilities](./docs/json.md)** - Complete guide to JSON operations
- **[Temporal Utilities](./docs/temporal.md)** - Working with PostgreSQL date/time types using Temporal API

## Agent Skills

This repository includes an agent skill for library-consumer usage examples and troubleshooting:

- **[drizzle-pg-utils](./skills/drizzle-pg-utils/SKILL.md)** - JSONB and Temporal helper guidance with query-focused examples

## License

MIT License - see [LICENSE.md](LICENSE.md) for details.
