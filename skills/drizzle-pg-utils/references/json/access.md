# JSON Access Helpers

Read JSONB paths with the callable ref API: `json(source).path.$value` or `.$text`. Refs also support writes; see [ref.md](ref.md).

`access(source)` (`json.access`, `jsonAccess`) is deprecated. It reads paths the same way; replace `json.access(source)` with `json(source)`.

## Imports

```typescript
import { json } from '@denny-il/drizzle-pg-utils'
```

## Select and Filter

```typescript
import { eq } from 'drizzle-orm'

const profile = json(users.profile)

const rows = await db
  .select({
    id: users.id,
    name: profile.user.name.$text,
    theme: profile.user.preferences.theme.$value,
    firstTag: profile.user.preferences.tags[0].$value,
  })
  .from(users)
  .where(eq(profile.user.preferences.theme.$text, 'dark'))
```

## Path Terminals

- `.$value` returns a typed JSONB SQL expression using `jsonb_extract_path(...)`.
- `.$text` returns a typed text SQL expression using `jsonb_extract_path_text(...)`.

Missing properties and SQL `NULL` sources return SQL `NULL` from both terminals. A JSON `null` property returns SQL `NULL` from `.$text` but JSON `null` from `.$value`; both decode to a JS `null`.

Compare strings with `.$text`, numbers with `.$number`, and booleans with `.$boolean`. A plain JS string compared with `.$value` is bound as JSONB and fails with `invalid input syntax for type json`, and `.$value` ranges follow JSONB ordering across types.

## Index Note

Path predicates operate on extracted expressions. If you filter on an extracted value and need an index, create an expression index matching the emitted expression. Declaring it from the same ref guarantees the match: `index('users_email_idx').on(json(users.profile).user.email.$text)` (read the outer table inside the `pgTable` callback; its own columns lose the JSON type). An index on `profile->>'email'` is not used for `jsonb_extract_path_text(profile, ...)`.

```typescript
const email = json(users.profile).user.email.$text

await db
  .select({ id: users.id })
  .from(users)
  .where(eq(email, 'ada@example.com'))
```

Do not compare extracted subdocuments for full-column JSONB containment. For GIN / `jsonb_path_ops` indexes on the source column, use `.$contains(...)`; see [contains.md](contains.md).
