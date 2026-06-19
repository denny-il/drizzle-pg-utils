# JSON Build, Coalesce, and Merge Helpers

Use these helpers to build JSONB values in SQL and compose JSONB expressions safely.

## Imports

```typescript
import { json } from '@denny-il/drizzle-pg-utils'
import { build, coalesce, merge } from '@denny-il/drizzle-pg-utils/json'
import { jsonBuild } from '@denny-il/drizzle-pg-utils/json/build'
import { jsonCoalesce } from '@denny-il/drizzle-pg-utils/json/coalesce'
import { jsonMerge } from '@denny-il/drizzle-pg-utils/json/merge'
```

## `build(...)`

`build(...)` accepts plain JavaScript values, nested objects, arrays, columns, and SQL expressions.

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

Plain JavaScript values are parameterized. Use them for user input.

```typescript
json.build({
  label: userInput,
})
```

## SQL Expression Trust Boundary

`sql\`...\`` means PostgreSQL should compute the value. It is not needed for normal user input.

When computed SQL expressions are embedded into JSONB, helpers convert them with `to_jsonb(...)` so PostgreSQL writes the expression result as JSON instead of placing a raw SQL scalar where JSONB is required.

```typescript
json.build({
  metadata: {
    importedAt: sql`now()::text`,
    rowId: users.id,
  },
})
```

Interpolated values inside `sql\`...\`` still use Drizzle parameters. `sql.raw(...)` is caller-controlled SQL and must not contain untrusted input.

## `coalesce(...)`

`coalesce(source, fallback)` treats SQL `NULL` and JSON `null` as empty and returns the fallback.

```typescript
json.coalesce(users.profile, json.build({ user: { name: 'New User' } }))
```

Use it when you need a complete fallback JSONB expression, not just a missing branch default. For path-level defaults during updates, prefer `.$default(...)`; see [updates.md](updates.md).

## `merge(...)`

`merge(left, right)` applies PostgreSQL JSONB `||` semantics after normalizing SQL `NULL` operands to JSON `null`.

```typescript
await db.update(users).set({
  profile: json.merge(
    users.profile,
    json.build({
      metadata: {
        source: 'api',
      },
    }),
  ),
})
```

Important semantics:

- Object merges are shallow; right-hand keys win.
- Array merges concatenate arrays.
- Mixed JSONB types follow PostgreSQL `||` behavior.
- SQL `NULL` is not plain `left || right`; helpers normalize it first.
