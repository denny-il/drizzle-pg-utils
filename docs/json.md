# JSON Utilities

Use typed JSONB expressions in Drizzle without runtime schemas.

The JSON helpers work with both JSONB columns and ad hoc SQL expressions typed as `SQL<T>`. The only runtime requirement is support for `Proxy`.

## Highlights

### Typed path access

```typescript
const profile = json.access(users.profile)

const rows = await db
  .select({
    theme: profile.user.preferences.theme.$value,
    themeText: profile.user.preferences.theme.$text,
    firstTag: profile.user.preferences.tags['0'].$value,
  })
  .from(users)
```

### Atomic multi-step updates

```typescript
await db.update(users).set({
  profile: json.setPipe(
    users.profile,
    (s) => s.user.preferences.$default({ theme: 'light', tags: [] }),
    (s) => s.user.preferences.theme.$set('dark'),
    (s) => s.user.preferences.tags['0'].$set('intro'),
  ),
})
```

### Build and merge JSONB in SQL

```typescript
await db.update(users).set({
  profile: json.merge(
    users.profile,
    json.build({
      source: 'api',
      tags: ['typescript', 'drizzle'],
    }),
  ),
})
```

## Choose an Import Style

| Import style | Use it when | Example |
| --- | --- | --- |
| Root namespace | You want one `json.*` namespace alongside the rest of the package. | `import { json } from '@denny-il/drizzle-pg-utils'` |
| JSON subpath | You only want JSON helpers. | `import { access, setPipe, merge } from '@denny-il/drizzle-pg-utils/json'` |
| Direct operation subpath | You want a single helper or smaller imports. | `import { jsonSet } from '@denny-il/drizzle-pg-utils/json/set'` |

There is no default export from `@denny-il/drizzle-pg-utils/json`.

## Quick Start

Install the package:

```bash
npm install @denny-il/drizzle-pg-utils
```

This example uses the root namespace import for consistency.

```typescript
import { eq, sql } from 'drizzle-orm'
import { jsonb, pgTable, serial, text } from 'drizzle-orm/pg-core'
import { json } from '@denny-il/drizzle-pg-utils'

type Profile = {
  user: {
    name: string
    preferences?: { theme: 'light' | 'dark'; tags?: string[] }
  }
  metadata?: { lastLogin?: string }
}

const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').notNull(),
  profile: jsonb('profile').$type<Profile>().notNull(),
})

const profile = json.access(users.profile)

const darkUsers = await db
  .select({
    id: users.id,
    theme: profile.user.preferences.theme.$value,
  })
  .from(users)
  .where(eq(profile.user.preferences.theme.$value, 'dark'))

await db
  .update(users)
  .set({
    profile: json.setPipe(
      users.profile,
      (s) => s.user.preferences.$default({ theme: 'light', tags: [] }),
      (s) => s.user.preferences.theme.$set('dark'),
      (s) => s.user.preferences.tags['0'].$set('intro'),
      (s) => s.metadata.$default({}).lastLogin.$set('2026-03-15T09:30:00Z'),
    ),
  })
  .where(eq(users.id, darkUsers[0]!.id))
```

## Query Examples

The helpers are meant to live inside normal Drizzle queries, not as separate object transforms.

### Select and filter by nested JSONB value

```typescript
import { eq } from 'drizzle-orm'

const profile = json.access(users.profile)

const darkUsers = await db
  .select({
    id: users.id,
    name: profile.user.name.$text,
    theme: profile.user.preferences.theme.$value,
  })
  .from(users)
  .where(eq(profile.user.preferences.theme.$value, 'dark'))
```

### Update nested JSONB values atomically

```typescript
await db
  .update(users)
  .set({
    profile: json.setPipe(
      users.profile,
      (s) => s.user.preferences.$default({ theme: 'light', tags: [] }),
      (s) => s.user.name.$set('Jane'),
      (s) => s.user.preferences.theme.$set('dark'),
      (s) => s.user.preferences.tags['0'].$set('intro'),
    ),
  })
  .where(eq(users.id, darkUsers[0]!.id))
```

This follows the same pattern tested with `jsonSetPipe(...)`: every step sees the JSONB expression produced by the previous step.

### Use SQL values inside JSON updates

```typescript
import { eq, sql } from 'drizzle-orm'

await db
  .update(users)
  .set({
    profile: json.set(users.profile).metadata.$default({}).lastLogin.$set(
      sql`now()::text`,
    ),
  })
  .where(eq(users.id, darkUsers[0]!.id))
```

### Build and merge JSONB in an update

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
  .where(eq(users.id, darkUsers[0]!.id))
```

### Update JSON arrays

```typescript
const tags = json.access(users.profile).user.preferences.tags.$value

await db
  .update(users)
  .set({
    profile: json.set(users.profile).user.preferences.tags.$set(
      json.arrayPush(tags, 'drizzle'),
    ),
  })
  .where(eq(users.id, darkUsers[0]!.id))
```

## Helper Map

| Helper | What it does | Notes |
| --- | --- | --- |
| `access(source)` | Typed JSON path extraction | Use `.$value` or `.$text` |
| `set(source)` | Build a single `jsonb_set(...)` update | Use `.$set(...)` and optional `.$default(...)` |
| `setPipe(source, ...ops)` | Chain multiple JSON updates | Each step sees the previous result; use `.$default(...)` to initialize SQL `NULL` roots or missing branches |
| `build(value)` | Convert JS values and SQL snippets into JSONB SQL | Handles nested arrays, objects, and SQL expressions |
| `coalesce(source, fallback)` | Replace SQL `NULL` and JSON `null` with a fallback | Useful before updates |
| `contains(source)` | Typed JSONB containment builder | Use `.$contains(...)`; emits full-column index-friendly `source @> value` |
| `contains(source, value)` | JSONB root containment predicate | Direct form for already-shaped containment values |
| `merge(left, right)` | Apply PostgreSQL JSONB `||` semantics | SQL `NULL` is normalized to JSON `null` first |
| `arrayPush(target, ...values)` | Append values to a JSON array | Nullish arrays become `[]`; `undefined` becomes JSON `null` |
| `arraySet(target, index, value)` | Replace an element at an index | Nullish arrays become `[]`; out-of-bounds indexes are no-ops |
| `arrayDelete(target, index)` | Remove an element at an index | Nullish arrays become `[]`; out-of-bounds indexes are no-ops |

## Important Behavior

### Containment keeps queries index-friendly

Use `contains(...)` for JSONB `@>` predicates that should use a full-column GIN or `jsonb_path_ops` index.

```typescript
await db
  .select({ id: users.id })
  .from(users)
  .where(
    json
      .contains(users.profile)
      .user.preferences.$contains({ theme: 'dark' }),
  )
```

That proxy form emits a root containment predicate:

```sql
profile @> '{"user":{"preferences":{"theme":"dark"}}}'::jsonb
```

The direct form is useful when you already have the full containment shape:

```typescript
json.contains(users.profile, {
  user: { preferences: { theme: 'dark' } },
})
```

Do not use `json.access(users.profile).user.preferences.$value @> ...` when you expect a full-column JSONB index to be used. That filters on `jsonb_extract_path(...)`, so it needs an expression index on the extracted path instead.

### Access is typed, but schema-free

You do not provide runtime schemas. The path is built through a `Proxy`, and TypeScript keeps the path typed from the column or `SQL<T>` source.

```typescript
const accessor = json.access(users.profile)

accessor.user.name.$value
accessor.user.name.$text
accessor.user.preferences.tags['0'].$value
```

- `.$value` returns a JSONB expression.
- `.$text` returns a text expression.
- `.$path` deprecated in favor of `.$value`.

### `$default(...)` is for missing intermediate branches

`jsonb_set(..., create_missing := true)` only creates the last missing segment. If an earlier branch is missing, PostgreSQL leaves the target unchanged.

Use `.$default(...)` on optional or nullable branches before deeper updates.

```typescript
const safeUpdate = json
  .set(users.profile)
  .user.preferences
  .$default({ theme: 'light', tags: [] })
  .theme.$set('dark')
```

Without `.$default(...)`, the update can silently do nothing when the intermediate object is missing.

`.$default(...)` is also the explicit way to initialize a SQL `NULL` root before writing nested fields. Without it, SQL `NULL` stays SQL `NULL`.

```typescript
await db.update(users).set({
  profile: json.setPipe(
    users.profile,
    (s) => s.user.$default({ name: 'New User' }),
    (s) => s.user.name.$set('Ada'),
  ),
})
```

Do not rely on `setPipe(...)` to turn a SQL `NULL` root into `{}` automatically. Add the default at the branch you want to create.

### Array helpers have distinct write semantics

Use `arrayPush(...)` when you want append behavior.

```typescript
const tags = json.access(users.profile).user.preferences.tags.$value

await db.update(users).set({
  profile: json.set(users.profile).user.preferences.tags.$set(
    json.arrayPush(tags, 'drizzle', 'postgres'),
  ),
})
```

Use `arraySet(...)` when you want to replace an existing element.

```typescript
await db.update(users).set({
  profile: json.set(users.profile).user.preferences.tags.$set(
    json.arraySet(tags, 0, 'intro'),
  ),
})
```

- `arrayPush(...)` appends every value in order.
- `arraySet(...)` uses PostgreSQL `jsonb_set(..., false)`, so out-of-bounds indexes are no-ops.
- `arrayDelete(...)` removes an existing element; out-of-bounds indexes are no-ops.
- All array helpers treat SQL `NULL` and JSON `null` targets as `[]`.
- `arrayPush(...)` and `arraySet(...)` convert JavaScript `undefined` to JSON `null`.

### Null handling is deliberate

The helpers do not all treat nullish values the same way.

- `access(...)` returns SQL `NULL` when the property is missing, JSON `null`, or the source itself is SQL `NULL`.
- `coalesce(...)` treats both SQL `NULL` and JSON `null` as empty and returns the fallback.
- `arrayPush(...)`, `arraySet(...)`, and `arrayDelete(...)` treat nullish array targets as `[]`.
- `merge(...)` normalizes SQL `NULL` to JSON `null` before applying PostgreSQL `||` semantics.

That behavior is useful, but it also means `merge(...)` is not a plain wrapper around `left || right` when SQL `NULL` is involved.

### Build once, reuse everywhere

`build(...)` accepts plain JS values, nested objects, arrays, and SQL expressions, then turns them into JSONB SQL.

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

That makes it a good companion for `set(...)`, `setPipe(...)`, and `merge(...)`.

SQL expressions are a trust boundary. Plain JavaScript values are always bound as query parameters, so user input should normally be passed as plain values:

```typescript
json.build({
  label: userInput,
})
```

Use `sql\`...\`` only when you intentionally want PostgreSQL to compute the value. When a computed SQL expression is embedded into JSONB, helpers wrap it with `to_jsonb(...)` so PostgreSQL writes the expression result as a JSON value instead of trying to place a raw SQL scalar where JSONB is required.

```typescript
json.build({
  metadata: {
    importedAt: sql`now()::text`,
    rowId: users.id,
  },
})
```

This produces JSON with values computed by PostgreSQL, while any interpolated values inside the SQL snippet still use Drizzle parameters. `sql.raw(...)` remains caller-controlled SQL and should not contain untrusted input.

## Common Patterns

### Select nested data

```typescript
const profile = json.access(users.profile)

const rows = await db
  .select({
    name: profile.user.name.$text,
    theme: profile.user.preferences.theme.$value,
  })
  .from(users)
```

### Update one path

```typescript
await db
  .update(users)
  .set({
    profile: json.set(users.profile).user.preferences.theme.$set('dark'),
  })
  .where(eq(users.id, userId))
```

### Update several paths in one expression

```typescript
await db.update(users).set({
  profile: json.setPipe(
    users.profile,
    (s) => s.user.name.$set('Den'),
    (s) => s.user.preferences.$default({ theme: 'light', tags: [] }),
    (s) => s.user.preferences.tags['0'].$set('postgres'),
  ),
})
```

### Merge overlay data

```typescript
await db.update(users).set({
  profile: json.merge(
    users.profile,
    json.build({
      metadata: { importedAt: '2026-03-15T09:30:00Z' },
    }),
  ),
})
```

### Work with arrays

```typescript
const tags = json.access(users.profile).user.preferences.tags.$value

await db.update(users).set({
  profile: json.set(users.profile).user.preferences.tags.$set(
    json.arrayPush(tags, 'drizzle'),
  ),
})
```

## Minimal Reference

### Namespace methods

- `json.access(source)`
- `json.arrayDelete(source, index)`
- `json.arrayPush(source, ...values)`
- `json.arraySet(source, index, value)`
- `json.build(value)`
- `json.coalesce(source, fallback)`
- `json.contains(source)`
- `json.contains(source, value)`
- `json.merge(left, right)`
- `json.set(source)`
- `json.setPipe(source, ...operations)`

### Direct operation exports

- `access` from `@denny-il/drizzle-pg-utils/json`
- `arrayDelete`, `arrayPush`, `arraySet` from `@denny-il/drizzle-pg-utils/json`
- `build` from `@denny-il/drizzle-pg-utils/json`
- `coalesce` from `@denny-il/drizzle-pg-utils/json`
- `contains` from `@denny-il/drizzle-pg-utils/json`
- `merge` from `@denny-il/drizzle-pg-utils/json`
- `set`, `setPipe` from `@denny-il/drizzle-pg-utils/json`

### Per-operation subpaths

- `@denny-il/drizzle-pg-utils/json/access`
- `@denny-il/drizzle-pg-utils/json/array`
- `@denny-il/drizzle-pg-utils/json/build`
- `@denny-il/drizzle-pg-utils/json/coalesce`
- `@denny-il/drizzle-pg-utils/json/contains`
- `@denny-il/drizzle-pg-utils/json/merge`
- `@denny-il/drizzle-pg-utils/json/set`
