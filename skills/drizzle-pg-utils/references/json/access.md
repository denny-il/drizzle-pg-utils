# JSON Access Helpers

Use `access(source)` to build typed JSONB path extraction expressions. It does not mutate JSON.

The callable ref API reads paths the same way (`json(users.profile).user.name.$text`) and also supports writes; see [ref.md](ref.md). `access(...)` remains the read-only builder.

## Imports

```typescript
import { json } from '@denny-il/drizzle-pg-utils'
import { access } from '@denny-il/drizzle-pg-utils/json'
import { jsonAccess } from '@denny-il/drizzle-pg-utils/json/access'
```

## Select and Filter

```typescript
import { eq } from 'drizzle-orm'

const profile = json.access(users.profile)

const rows = await db
  .select({
    id: users.id,
    name: profile.user.name.$text,
    theme: profile.user.preferences.theme.$value,
    firstTag: profile.user.preferences.tags[0].$value,
  })
  .from(users)
  .where(eq(profile.user.preferences.theme.$value, 'dark'))
```

## Path Terminals

- `.$value` returns a typed JSONB SQL expression using `jsonb_extract_path(...)`.
- `.$text` returns a typed text SQL expression using `jsonb_extract_path_text(...)`.

Missing properties, JSON `null`, and SQL `NULL` sources decode as SQL `NULL`.

## Index Note

Accessor predicates operate on extracted expressions. If you filter on an accessor value and need an index, create an expression index matching the emitted expression.

```typescript
const email = json.access(users.profile).user.email.$text

await db
  .select({ id: users.id })
  .from(users)
  .where(eq(email, 'ada@example.com'))
```

Do not use accessor subdocuments for full-column JSONB containment. For GIN / `jsonb_path_ops` indexes on the source column, use `contains(...)`; see [contains.md](contains.md).
