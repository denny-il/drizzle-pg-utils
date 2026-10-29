# JSON Path Queries

Use `json(source).$path` to query array items, object-map values, values at any depth, and items matching a condition with a typed, read-only SQL/JSON path (lax mode, PostgreSQL 14+; only `$valueAs` needs 17+). `json.path(source)` and `path(source)` from `@denny-il/drizzle-pg-utils/json` are the same builder; `json.path(source, { mode: 'strict' })` builds it in strict mode.

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
- `$deep` → `.**`: the item and every nested value, typed `unknown`. Lax mode yields items reached through arrays twice; use strict mode for `$query` and aggregates.
- `$key(name)` for `Record` keys, numeric-looking keys (`$key('0')`), and `$`-prefixed or helper-named keys. Numeric property names are array indexes.
- `$filter((node, p) => predicate)` keeps matching items; `$match({ kind: 'click' })` keeps items with those scalar values and narrows union types.
- `.$exists` → `source @? path` (GIN-indexable); `.$query` → `jsonb_path_query_array` (`[]` when nothing matches); `.$first` → `jsonb_path_query_first` (SQL `NULL` when nothing matches).
- `.$count` (JSON `null` included; `0` for no items or a SQL `NULL` source); `.$sum`, `.$avg`, `.$min`, `.$max` on number paths (ignore JSON `null`; SQL `NULL` when no number). Each is a scalar subquery; for several aggregates or grouping, use `$rows`.
- `.$test((node, p) => predicate)` → `source @@ predicate`, `node` being the current path. Returns SQL `NULL` for an unknown result (e.g. string vs number), where `$filter(...).$exists` returns `false`.
- `.$valueAs(type, { onEmpty?, onError? })` → `JSON_VALUE(... RETURNING type)`, **PostgreSQL 17+ only**. Types: `'text'`, `'integer'`, `'double precision'`, `'boolean'`. Converts numeric/boolean strings; SQL `NULL` for no item, several items, objects/arrays, or failed conversion unless `'error'` is passed. No defaults: use `coalesce(...)`.
- `.$rows(alias, (item, ordinality) => ({ col: item.x.$number, ... }))` → a Drizzle subquery over `jsonb_path_query(...) with ordinality`, for `crossJoinLateral(...)` or `leftJoinLateral(..., sql\`true\`)`. Columns must be SQL (`$text`, `$number`, `$boolean`, `$value`), not refs. Nest by building `$rows`over a`$value`column of another`$rows`. Use it instead of `JSON_TABLE`, which the library does not wrap.

```typescript
const audits = json(reports.result).$path.audits.$entries.$rows(
  'audits',
  (entry, ordinality) => ({
    key: entry.key.$text,
    score: entry.value.score.$number,
    ordinality,
  }),
)

await db
  .select({ id: reports.id, key: audits.key, score: audits.score })
  .from(reports)
  .crossJoinLateral(audits)
  .where(lt(audits.score, 1))
```

## Predicates

- On the filter node and its paths: `$eq`, `$ne`, `$in([...])`; `$lt`, `$lte`, `$gt`, `$gte` on numbers and strings; `$startsWith`, `$regex(pattern, flags?)` on strings (`like_regex`, flags from `imsq`); `$exists`; `$isNull` (present JSON `null`).
- `p.and`, `p.or`, `p.not` skip `undefined`. Write JS-side conditions inline as `cond ? predicate : undefined`; never interpolate JS booleans or SQL into a path.
- `p.sql(value)` compares against a column or typed `sql<T>` through a jsonpath variable: `audit.score.$lt(p.sql(thresholds.minScore))`. Cast untyped params (`` sql<number>`${n}::float8` ``). SQL `NULL` becomes JSON `null`. A path with a variable uses `jsonb_path_exists`/`jsonb_path_match` instead of `@?`/`@@`, so no index serves it. Prefixes and regex patterns stay literal.
- To combine with other SQL conditions, wrap `.$exists` in Drizzle `and(...)`.

## Rules

- Comparisons are type-strict: `"5"` does not equal `5`, and missing keys never match. `$ne(x)` is "some item differs", not `p.not($eq(x))`.
- Same-item conditions on array items need a nested filter: `node.items.$each.$filter((item, p) => p.and(item.a.$eq(1), item.b.$eq(1))).$exists`.
- Use `$each` before `$filter` / `$match` on arrays (type-enforced): lax mode unwraps arrays.
- Values become JSON literals inside one bound jsonpath parameter; only JS scalars and `p.sql(...)` variables are accepted.
- Strict mode raises on missing keys and wrong container types in `$query`, `$first`, aggregates, `$rows`, and `$valueAs`; `$exists` and `$test` become SQL `NULL` (typed `boolean | null`). Steps right after `$deep` still skip items without the key.
- `$path` exists only on the root ref.

## Index Behavior

- `.$exists` is `@?` and `.$test` is `@@`, which full-column GIN indexes support. Equality (`$eq`, `$in`, `$match`) narrows with `jsonb_ops` and `jsonb_path_ops`, including through `$each`.
- Equality below `$values` or `$deep` narrows only with `jsonb_ops` (the default operator class).
- Paths with `p.sql(...)` variables are never index-assisted.
- Ranges, `$startsWith`, `$regex`, existence-only paths, and anything below `$entries` (`.keyvalue()`) scan the whole GIN index; pair them with a selective equality, and prefer `$values` over `$entries` when the key is not needed.
