# JSON Helpers Reference

Use this file as the router. Read it first, then load the focused helper file that matches the task:

- [json/access.md](json/access.md) for `access(...)`, `.$value`, `.$text`, path extraction, and expression-index implications.
- [json/updates.md](json/updates.md) for `set(...)`, `setPipe(...)`, `.$set(...)`, `.$default(...)`, missing branches, and SQL `NULL` roots.
- [json/arrays.md](json/arrays.md) for `arrayPush(...)`, `arraySet(...)`, `arrayDelete(...)`, out-of-bounds behavior, and `undefined` handling.
- [json/contains.md](json/contains.md) for `contains(...)`, `.$contains(...)`, JSONB `@>`, and full-column GIN / `jsonb_path_ops` indexes.
- [json/build-coalesce-merge.md](json/build-coalesce-merge.md) for `build(...)`, `coalesce(...)`, `merge(...)`, SQL expressions, `to_jsonb(...)`, and trust boundaries.

## Imports

```typescript
import { json } from '@denny-il/drizzle-pg-utils'
import {
  access,
  arrayPush,
  build,
  contains,
  merge,
  setPipe,
} from '@denny-il/drizzle-pg-utils/json'
import { jsonSet } from '@denny-il/drizzle-pg-utils/json/set'
```

There is no default export from `@denny-il/drizzle-pg-utils/json`.

## Helper Map

| Helper | Use | Focused reference |
| --- | --- | --- |
| `access(source)` | Typed JSON path extraction | [json/access.md](json/access.md) |
| `set(source)` | One `jsonb_set(...)` update | [json/updates.md](json/updates.md) |
| `setPipe(source, ...ops)` | Chain JSON updates; each step sees previous result | [json/updates.md](json/updates.md) |
| `build(value)` | Convert JS values and SQL snippets into JSONB SQL | [json/build-coalesce-merge.md](json/build-coalesce-merge.md) |
| `coalesce(source, fallback)` | Treat SQL `NULL` and JSON `null` as empty | [json/build-coalesce-merge.md](json/build-coalesce-merge.md) |
| `merge(left, right)` | Apply PostgreSQL JSONB `||` semantics with SQL `NULL` normalized | [json/build-coalesce-merge.md](json/build-coalesce-merge.md) |
| `contains(source)` | Typed root JSONB containment builder | [json/contains.md](json/contains.md) |
| `contains(source, value)` | Direct JSONB root containment predicate | [json/contains.md](json/contains.md) |
| `arrayPush(target, ...values)` | Append values to JSON array | [json/arrays.md](json/arrays.md) |
| `arraySet(target, index, value)` | Replace existing array element | [json/arrays.md](json/arrays.md) |
| `arrayDelete(target, index)` | Remove existing array element | [json/arrays.md](json/arrays.md) |

## Common Query Shape

Prefer showing helpers inside Drizzle queries, not as standalone object transforms.

```typescript
const profile = json.access(users.profile)

await db
  .update(users)
  .set({
    profile: json.setPipe(
      users.profile,
      (s) => s.user.preferences.$default({ theme: 'light', tags: [] }),
      (s) => s.user.preferences.theme.$set('dark'),
      (s) => s.user.preferences.tags.$set(
        json.arrayPush(profile.user.preferences.tags.$value, 'drizzle'),
      ),
    ),
  })
  .where(eq(users.id, userId))
```

## High-Signal Rules

- Use `contains(...)` for index-friendly JSONB containment rooted at the full JSONB source.
- Use `.$default(...)` before writing through missing branches or SQL `NULL` roots.
- Use `arrayPush(...)` for append behavior; `arraySet(...)` is replacement-only and out-of-bounds writes are no-ops.
- Pass user input as plain JavaScript values. Use `sql\`...\`` only when PostgreSQL should compute the value.
- Prefer a focused reference file over adding more examples here. Keep this router short enough to load often.
