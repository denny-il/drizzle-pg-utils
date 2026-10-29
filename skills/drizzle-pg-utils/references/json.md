# JSON Helpers Reference

Use this file as the router. Read it first, then load the focused helper file that matches the task:

- [json/ref.md](json/ref.md) for the callable `json(source)` ref API: path access, `.$set(...)`, `.$default(...)`, `.$push(...)`, `.$merge(...)`, `.$contains(...)`, `.$pipe(...)`, and `.$key(...)`. This is the primary API.
- [json/access.md](json/access.md) for `.$value`, `.$text`, the deprecated `access(...)`, path extraction, and expression-index implications.
- [json/updates.md](json/updates.md) for `.$set(...)`, `.$default(...)`, missing branches, SQL `NULL` roots, and the deprecated `set(...)` / `setPipe(...)`.
- [json/arrays.md](json/arrays.md) for `arrayPush(...)`, `arraySet(...)`, `arrayDelete(...)`, out-of-bounds behavior, and `undefined` handling.
- [json/path.md](json/path.md) for `json(source).$path`: SQL/JSON path queries over array items, object-map values, and nested values with `$filter(...)`, `$match(...)`, `$deep`, `p.sql(...)` variables, strict mode, the terminals `$exists`, `$query`, `$first`, `$count`/`$sum`/..., `$test`, `$valueAs` (PostgreSQL 17+), and `$rows` (JSON to rows), and their GIN index behavior.
- [json/contains.md](json/contains.md) for `.$contains(...)`, the deprecated `contains(...)`, JSONB `@>`, and full-column GIN / `jsonb_path_ops` indexes.
- [json/build-coalesce-merge.md](json/build-coalesce-merge.md) for `build(...)`, `coalesce(...)`, `merge(...)`, SQL expressions, `to_jsonb(...)`, and trust boundaries.

## Imports

```typescript
import { json } from '@denny-il/drizzle-pg-utils'
import { arrayPush, build, merge, pipe } from '@denny-il/drizzle-pg-utils/json'
import { jsonRef, jsonRefPipe } from '@denny-il/drizzle-pg-utils/json/ref'
```

`json` is callable: `json(source)` creates a typed ref, and the same value carries the namespace (`json.pipe`, `json.build`, `json.merge`, ...). There is no default export from `@denny-il/drizzle-pg-utils/json`.

## Helper Map

| Helper                                                | Use                                                            | Focused reference                                            |
| ----------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------ |
| `json(source)`                                        | Callable typed ref: access, updates, containment, pipes        | [json/ref.md](json/ref.md)                                   |
| `json(source).$pipe(...ops)` / `pipe(source, ...ops)` | Chain JSON updates; each step sees previous result             | [json/ref.md](json/ref.md)                                   |
| `json(source).$path` / `path(source)`                 | Typed SQL/JSON path queries; filter array items and map values | [json/path.md](json/path.md)                                 |
| `json(source).$path...$rows(alias, columns)`          | One row per path item, for lateral joins                       | [json/path.md](json/path.md)                                 |
| `access(source)`                                      | Deprecated; use `json(source).path.$value` / `.$text`          | [json/access.md](json/access.md)                             |
| `set(source)`                                         | Deprecated; use `json(source).path.$set(...)`                  | [json/updates.md](json/updates.md)                           |
| `setPipe(source, ...ops)`                             | Deprecated; use `json(source).$pipe(...)`                      | [json/updates.md](json/updates.md)                           |
| `build(value)`                                        | Convert JS values and SQL snippets into JSONB SQL              | [json/build-coalesce-merge.md](json/build-coalesce-merge.md) |
| `coalesce(source, fallback)`                          | Treat SQL `NULL` and JSON `null` as empty                      | [json/build-coalesce-merge.md](json/build-coalesce-merge.md) |
| `merge(left, right)`                                  | Apply PostgreSQL JSONB `\|\|` semantics, SQL `NULL` normalized | [json/build-coalesce-merge.md](json/build-coalesce-merge.md) |
| `contains(source)` / `contains(source, value)`        | Deprecated; use `json(source).path.$contains(...)`             | [json/contains.md](json/contains.md)                         |
| `arrayPush(target, ...values)`                        | Append values to JSON array                                    | [json/arrays.md](json/arrays.md)                             |
| `arraySet(target, index, value)`                      | Replace existing array element                                 | [json/arrays.md](json/arrays.md)                             |
| `arrayDelete(target, index)`                          | Remove existing array element                                  | [json/arrays.md](json/arrays.md)                             |

## Common Query Shape

Prefer showing helpers inside Drizzle queries, not as standalone object transforms.

```typescript
const profile = json(users.profile)

const rows = await db
  .select({
    id: users.id,
    theme: profile.user.preferences.theme.$value,
  })
  .from(users)
  .where(profile.user.preferences.$contains({ theme: 'dark' }))

await db
  .update(users)
  .set({
    profile: profile.$pipe(
      (s) => s.user.preferences.$default({ theme: 'light', tags: [] }),
      (s) => s.user.preferences.theme.$set('dark'),
      (s) => s.user.preferences.tags.$push('drizzle'),
    ),
  })
  .where(eq(users.id, userId))
```

## High-Signal Rules

- Prefer the callable `json(source)` ref API for new code; `access`/`set`/`contains` builders remain for existing code, and `setPipe` is deprecated.
- Use `.$contains(...)` for index-friendly JSONB containment rooted at the full JSONB source. Containment below an array index is a type error by design.
- Use `.$default(...)` before writing through missing branches or SQL `NULL` roots; inside `$pipe`, a step may return the `$default(...)` continuation directly.
- Use `.$push(...)` / `arrayPush(...)` for append behavior; `arraySet(...)` is replacement-only and out-of-bounds writes are no-ops.
- Compare extracted strings with `.$text` and numbers / booleans with `.$number` / `.$boolean`; never compare `.$value` with a plain JS string.
- Use `json(source).$path` to filter array items or object-map values; write JS-side conditions as `cond ? predicate : undefined`, never interpolated into a path.
- Use `.$key('name')` for JSON keys that collide with helper names (`$value`, `$set`, `getSQL`, ...) or for dynamic keys.
- Pass user input as plain JavaScript values. Use `sql\`...\`` only when PostgreSQL should compute the value.
- Prefer a focused reference file over adding more examples here. Keep this router short enough to load often.
