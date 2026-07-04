# JSON Update Helpers

Prefer the callable ref API for updates: `json(source).path.$set(...)` for one write and `json(source).$pipe(...)` for chained writes. See [ref.md](ref.md) for the full ref API. `set(source)` remains available; `setPipe(...)` is deprecated.

## Imports

```typescript
import { json } from '@denny-il/drizzle-pg-utils'
import { pipe, set } from '@denny-il/drizzle-pg-utils/json'
import { jsonSet } from '@denny-il/drizzle-pg-utils/json/set'
```

## Single Path Update

```typescript
await db
  .update(users)
  .set({
    profile: json(users.profile).user.preferences.theme.$set('dark'),
  })
  .where(eq(users.id, userId))
```

`.$set(value, createMissing?)` writes one JSONB path. `createMissing` defaults to `true` for the final segment.

## Multi-Step Update

```typescript
await db
  .update(users)
  .set({
    profile: json(users.profile).$pipe(
      (s) => s.user.preferences.$default({ theme: 'light', tags: [] }),
      (s) => s.user.name.$set('Ada'),
      (s) => s.user.preferences.theme.$set('dark'),
    ),
  })
  .where(eq(users.id, userId))
```

Use `$pipe` instead of manually nesting `$set` calls when later writes depend on earlier writes. `json.pipe(source, ...ops)` is the standalone form.

## Defaults and SQL NULL Roots

PostgreSQL `jsonb_set(..., create_missing := true)` creates only the final missing segment. It does not create all missing intermediate objects.

Use `.$default(...)` before writing through optional or nullable branches:

```typescript
json(users.profile).user.preferences
  .$default({ theme: 'light', tags: [] })
  .theme.$set('dark')
```

Use `.$default(...)` before nested writes to SQL `NULL` roots too. `$pipe` preserves SQL `NULL` unless a step explicitly creates the branch:

```typescript
await db.update(users).set({
  profile: json(users.profile).$pipe(
    (s) => s.user.$default({ name: 'New User' }),
    (s) => s.user.name.$set('Ada'),
  ),
})
```

Without `.$default(...)`, a nested write through SQL `NULL` stays SQL `NULL`.

## SQL Values

`.$set(...)` and `.$default(...)` accept plain JavaScript values and SQL expressions. Plain values stay parameterized. Use `sql\`...\`` only when PostgreSQL should compute the value:

```typescript
await db.update(users).set({
  profile: json(users.profile).metadata.$default({}).lastLogin.$set(
    sql`now()::text`,
  ),
})
```

For SQL expression conversion details and trust boundaries, see [build-coalesce-merge.md](build-coalesce-merge.md).

## Legacy Builders

`json.set(source)` builds the same single-path update through a dedicated proxy and remains supported:

```typescript
json.set(users.profile).user.preferences.theme.$set('dark')
```

`json.setPipe(source, ...ops)` is deprecated. Migrate to `json(source).$pipe(...)` or `json.pipe(source, ...ops)`; the step signature is unchanged.
