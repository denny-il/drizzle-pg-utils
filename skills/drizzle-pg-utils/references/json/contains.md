# JSON Containment Helpers

Use `.$contains(...)` on a ref or `contains(...)` for JSONB `@>` predicates rooted at the original JSONB source.

## Imports

```typescript
import { json } from '@denny-il/drizzle-pg-utils'
import { contains } from '@denny-il/drizzle-pg-utils/json'
import { jsonContains } from '@denny-il/drizzle-pg-utils/json/contains'
```

## Ref Form

```typescript
await db
  .select({ id: users.id })
  .from(users)
  .where(json(users.profile).user.preferences.$contains({ theme: 'dark' }))
```

Containment below an array index (`json(...).items[0].meta.$contains(...)`) is a type error by design: JSONB `@>` cannot address array positions. Use containment on the array path itself instead.

## Path Proxy Form

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

This emits a root containment predicate:

```sql
profile @> '{"user":{"preferences":{"theme":"dark"}}}'::jsonb
```

It does not emit containment on `jsonb_extract_path(...)`.

## Direct Form

Use the direct form when the containment shape is already built:

```typescript
json.contains(users.profile, {
  user: { preferences: { theme: 'dark' } },
})
```

SQL containment values are allowed at the root:

```typescript
json.contains(
  users.profile,
  json.build({ user: { preferences: { theme: 'dark' } } }),
)
```

SQL values are intentionally not supported inside nested proxy paths because the helper must wrap nested path values into an object shape.

## Index Behavior

Because `contains(...)` keeps predicates rooted at `source @> value`, PostgreSQL can use full-column JSONB indexes:

```sql
create index users_profile_gin_idx on users using gin (profile);
create index users_profile_path_idx on users using gin (profile jsonb_path_ops);
```

Do not use `json.access(users.profile).user.preferences.$value @> ...` when expecting those full-column indexes. That filters on `jsonb_extract_path(...)` and needs a matching expression index instead.
