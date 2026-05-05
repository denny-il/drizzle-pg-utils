# JSON Helpers Reference

## Imports

```typescript
import { json } from '@denny-il/drizzle-pg-utils'
import { access, contains, setPipe, merge } from '@denny-il/drizzle-pg-utils/json'
import { jsonSet } from '@denny-il/drizzle-pg-utils/json/set'
```

There is no default export from `@denny-il/drizzle-pg-utils/json`.

## Access

```typescript
import { eq } from 'drizzle-orm'

const profile = json.access(users.profile)

const rows = await db
  .select({
    name: profile.user.name.$text,
    theme: profile.user.preferences.theme.$value,
    firstTag: profile.user.preferences.tags[0].$value,
  })
  .from(users)
  .where(eq(profile.user.preferences.theme.$value, 'dark'))
```

- `.$value` returns a typed JSONB SQL expression.
- `.$text` returns a typed text SQL expression.
- `.$path` is deprecated; use `.$value`.

## Updates

```typescript
await db
  .update(users)
  .set({
    profile: json.setPipe(
      users.profile,
      (s) => s.user.preferences.$default({ theme: 'light', tags: [] }),
      (s) => s.user.preferences.theme.$set('dark'),
      (s) => s.user.preferences.tags[0].$set('intro'),
    ),
  })
  .where(eq(users.id, userId))
```

Use `.$default(...)` before writing through optional or nullable intermediate objects. Without it, PostgreSQL can leave the document unchanged when an earlier path segment is missing.

## Helper Map

| Helper | Use |
| --- | --- |
| `access(source)` | Typed JSON path extraction |
| `set(source)` | One `jsonb_set(...)` update |
| `setPipe(source, ...ops)` | Chain multiple JSON updates |
| `build(value)` | Convert JS values and SQL snippets into JSONB SQL |
| `coalesce(source, fallback)` | Treat SQL `NULL` and JSON `null` as empty |
| `contains(source)` | Typed JSONB containment builder; use `.$contains(...)` |
| `contains(source, value)` | Direct JSONB root containment predicate |
| `merge(left, right)` | Apply PostgreSQL JSONB `||` semantics with SQL `NULL` normalized |
| `arrayPush(target, ...values)` | Append values to JSON array; nullish arrays become `[]` |
| `arraySet(target, index, value)` | Replace array element; nullish arrays become `[]` |
| `arrayDelete(target, index)` | Remove array element; nullish arrays become `[]` |

## Build Example

```typescript
await db.update(users).set({
  profile: json.merge(
    users.profile,
    json.build({
      audit: {
        at: sql`now()::text`,
        actorId: users.id,
        action: 'profile-updated',
      },
    }),
  ),
})
```

`json.build(...)` accepts plain JS values, nested objects, arrays, and SQL expressions.

## Query Patterns

### Index-friendly JSONB containment

```typescript
await db
  .select({ id: users.id })
  .from(users)
  .where(
    contains(users.profile).user.preferences.$contains({ theme: 'dark' }),
  )
```

This emits `profile @> ...`, so full-column GIN and `jsonb_path_ops` indexes can be used. Direct form is also available:

```typescript
contains(users.profile, {
  user: { preferences: { theme: 'dark' } },
})
```

### SQL value in JSON update

```typescript
import { eq, sql } from 'drizzle-orm'

await db
  .update(users)
  .set({
    profile: json.set(users.profile).metadata.$default({}).lastLogin.$set(
      sql`now()::text`,
    ),
  })
  .where(eq(users.id, userId))
```

### Merge built JSONB in update

```typescript
import { eq, sql } from 'drizzle-orm'

await db
  .update(users)
  .set({
    profile: json.merge(
      users.profile,
      json.build({
        metadata: {
          importedAt: sql`now()::text`,
          source: 'api',
        },
      }),
    ),
  })
  .where(eq(users.id, userId))
```

### Array update inside JSON document

```typescript
const tags = json.access(users.profile).user.preferences.tags.$value

await db
  .update(users)
  .set({
    profile: json.set(users.profile).user.preferences.tags.$set(
      json.arrayPush(tags, 'drizzle'),
    ),
  })
  .where(eq(users.id, userId))
```
