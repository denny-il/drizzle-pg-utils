# JSON Path Queries

Use `json(source).$path` to query array items, object-map values, and items matching a condition with a typed, read-only SQL/JSON path (lax mode, PostgreSQL 14+). `json.path(source)` and `path(source)` from `@denny-il/drizzle-pg-utils/json` are the same builder.

## Imports

```typescript
import { json } from '@denny-il/drizzle-pg-utils'
// or: import { path } from '@denny-il/drizzle-pg-utils/json'
// or: import { jsonPath } from '@denny-il/drizzle-pg-utils/json/path'
```

## Query Shape

```typescript
type Audit = {
  id: string
  score: number | null
  mode: 'binary' | 'numeric' | 'manual'
}
type Report = {
  audits: Record<string, Audit>
  events: Array<{ kind: 'click'; x: number } | { kind: 'key'; code: string }>
}

const report = json(reports.result).$path

const failing = report.audits.$values.$filter((audit, p) =>
  p.and(
    audit.score.$lt(1),
    audit.mode.$in(['binary', 'numeric']),
    onlyBinary ? audit.mode.$eq('binary') : undefined,
  ),
)

const rows = await db
  .select({
    id: reports.id,
    failingIds: failing.id.$query,
    firstClickX: report.events.$each.$match({ kind: 'click' }).x.$first,
  })
  .from(reports)
  .where(failing.$exists)
```

## Steps and Terminals

- `.key` → `."key"`, `[n]` → `[n]`, `$each` → `[*]` (arrays), `$values` → `.*` (objects and `Record`s), `$entries` → `.keyvalue()` items `{ key, value, id }` (guarded so JSON `null` and other non-objects yield nothing instead of raising an error). Lax mode treats JSON `null` in place of an array as a one-item array, so `$each` and `[n]` can yield `null`.
- `$key(name)` for `Record` keys, numeric-looking keys (`$key('0')`), and `$`-prefixed or helper-named keys. Numeric property names are array indexes.
- `$filter((node, p) => predicate)` keeps matching items; `$match({ kind: 'click' })` keeps items with those scalar values and narrows union types.
- `.$exists` → `source @? path` (GIN-indexable); `.$query` → `jsonb_path_query_array` (`[]` when nothing matches); `.$first` → `jsonb_path_query_first` (SQL `NULL` when nothing matches).

## Predicates

- On the filter node and its paths: `$eq`, `$ne`, `$in([...])`; `$lt`, `$lte`, `$gt`, `$gte` on numbers and strings; `$startsWith`, `$regex(pattern, flags?)` on strings (`like_regex`, flags from `imsq`); `$exists`; `$isNull` (present JSON `null`).
- `p.and`, `p.or`, `p.not` skip `undefined`. Write JS-side conditions inline as `cond ? predicate : undefined`; never interpolate JS booleans or SQL into a path.
- To combine with SQL conditions, wrap `.$exists` in Drizzle `and(...)`.

## Rules

- Comparisons are type-strict: `"5"` does not equal `5`, and missing keys never match. `$ne(x)` is "some item differs", not `p.not($eq(x))`.
- Same-item conditions on array items need a nested filter: `node.items.$each.$filter((item, p) => p.and(item.a.$eq(1), item.b.$eq(1))).$exists`.
- Use `$each` before `$filter` / `$match` on arrays (type-enforced): lax mode unwraps arrays.
- Values become JSON literals inside one bound jsonpath parameter; only JS scalars are accepted.
- `$path` exists only on the root ref.

## Index Behavior

- `.$exists` is `@?`, which full-column GIN indexes support. Equality (`$eq`, `$in`, `$match`) narrows with `jsonb_ops` and `jsonb_path_ops`, including through `$each`.
- Equality below `$values` narrows only with `jsonb_ops` (the default operator class).
- Ranges, `$startsWith`, `$regex`, existence-only paths, and anything below `$entries` (`.keyvalue()`) scan the whole GIN index; pair them with a selective equality, and prefer `$values` over `$entries` when the key is not needed.
