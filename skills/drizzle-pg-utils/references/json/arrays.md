# JSON Array Helpers

Use array helpers when the target expression is a JSONB array or nullable JSONB array.

For appends on a document path, the ref API is shorter: `json(users.profile).user.preferences.tags.$push('drizzle')` returns the full updated document; see [ref.md](ref.md). The helpers below operate on the array expression itself.

## Imports

```typescript
import { json } from '@denny-il/drizzle-pg-utils'
import { arrayDelete, arrayPush, arraySet } from '@denny-il/drizzle-pg-utils/json'
import {
  jsonArrayDelete,
  jsonArrayPush,
  jsonArraySet,
} from '@denny-il/drizzle-pg-utils/json/array'
```

## Append Values

Use `arrayPush(target, ...values)` for append semantics.

```typescript
const tags = json.access(users.profile).user.preferences.tags.$value

await db
  .update(users)
  .set({
    profile: json.set(users.profile).user.preferences.tags.$set(
      json.arrayPush(tags, 'drizzle', 'postgres'),
    ),
  })
  .where(eq(users.id, userId))
```

`arrayPush(...)` appends every value in order. SQL `NULL` and JSON `null` targets are treated as `[]`.

## Replace Existing Element

Use `arraySet(target, index, value)` when replacing an existing index.

```typescript
await db.update(users).set({
  profile: json.set(users.profile).user.preferences.tags.$set(
    json.arraySet(tags, 0, 'intro'),
  ),
})
```

`arraySet(...)` uses PostgreSQL `jsonb_set(..., false)`, so out-of-bounds writes are no-ops. It does not append or prepend. Use `arrayPush(...)` for append behavior.

## Delete Existing Element

```typescript
await db.update(users).set({
  profile: json.set(users.profile).user.preferences.tags.$set(
    json.arrayDelete(tags, 0),
  ),
})
```

Out-of-bounds deletes are no-ops.

## Nullish and Undefined Values

- All array helpers treat SQL `NULL` and JSON `null` targets as `[]`.
- `arrayPush(...)` and `arraySet(...)` map JavaScript `undefined` to JSON `null`.
- Plain JavaScript values stay parameterized.
- SQL expressions are accepted when PostgreSQL should compute the value.
