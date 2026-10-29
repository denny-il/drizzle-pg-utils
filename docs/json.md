# JSON Utilities

Use typed JSONB expressions in Drizzle without runtime schemas.

The JSON helpers work with both JSONB columns and ad hoc SQL expressions typed as `SQL<T>`. The only runtime requirement is support for `Proxy`.

The helpers emit JSONB functions and operators only. Plain `json` columns are not supported; cast them first, for example `json(sql<Profile>\`${users.profile}::jsonb\`)`.

## Highlights

### Typed ref access

```typescript
const profile = json(users.profile)

const rows = await db
  .select({
    theme: profile.user.preferences.theme.$value,
    themeText: profile.user.preferences.theme.$text,
    firstTag: profile.user.preferences.tags['0'].$value,
  })
  .from(users)
```

### Typed JSON path queries

```typescript
const failing = json(reports.result).$path.audits.$values.$filter((audit, p) =>
  p.and(audit.score.$lt(1), audit.mode.$in(['binary', 'numeric'])),
)

const rows = await db
  .select({ id: reports.id, failing: failing.$query })
  .from(reports)
  .where(failing.$exists)
```

### Atomic multi-step updates

```typescript
await db.update(users).set({
  profile: json(users.profile).$pipe(
    (s) => s.user.preferences.$default({ theme: 'light', tags: [] }),
    (s) => s.user.preferences.theme.$set('dark'),
    (s) => s.user.preferences.tags['0'].$set('intro'),
  ),
})
```

### Build and merge JSONB in SQL

```typescript
await db.update(users).set({
  profile: json.merge(
    users.profile,
    json.build({
      source: 'api',
      tags: ['typescript', 'drizzle'],
    }),
  ),
})
```

## Choose an Import Style

| Import style             | Use it when                                                        | Example                                                                |
| ------------------------ | ------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Root namespace           | You want one `json.*` namespace alongside the rest of the package. | `import { json } from '@denny-il/drizzle-pg-utils'`                    |
| JSON subpath             | You only want JSON helpers.                                        | `import { pipe, merge, build } from '@denny-il/drizzle-pg-utils/json'` |
| Direct operation subpath | You want a single helper or smaller imports.                       | `import { jsonMerge } from '@denny-il/drizzle-pg-utils/json/merge'`    |

There is no default export from `@denny-il/drizzle-pg-utils/json`.

## Quick Start

Install the package:

```bash
npm install @denny-il/drizzle-pg-utils
```

This example uses the root namespace import for consistency.

```typescript
import { json } from '@denny-il/drizzle-pg-utils'
import { eq, sql } from 'drizzle-orm'
import { jsonb, pgTable, serial, text } from 'drizzle-orm/pg-core'

type Profile = {
  user: {
    name: string
    preferences?: { theme: 'light' | 'dark'; tags?: string[] }
  }
  metadata?: { lastLogin?: string }
}

const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').notNull(),
  profile: jsonb('profile').$type<Profile>().notNull(),
})

const profile = json(users.profile)

const darkUsers = await db
  .select({
    id: users.id,
    theme: profile.user.preferences.theme.$value,
  })
  .from(users)
  .where(eq(profile.user.preferences.theme.$text, 'dark'))

await db
  .update(users)
  .set({
    profile: json(users.profile).$pipe(
      (s) => s.user.preferences.$default({ theme: 'light', tags: [] }),
      (s) => s.user.preferences.theme.$set('dark'),
      (s) => s.user.preferences.tags['0'].$set('intro'),
      (s) => s.metadata.$default({}).lastLogin.$set('2026-03-15T09:30:00Z'),
    ),
  })
  .where(eq(users.id, darkUsers[0]!.id))
```

## Query Examples

The helpers are meant to live inside normal Drizzle queries, not as separate object transforms.

### Select and filter by nested JSONB value

```typescript
import { eq } from 'drizzle-orm'

const profile = json(users.profile)

const darkUsers = await db
  .select({
    id: users.id,
    name: profile.user.name.$text,
    theme: profile.user.preferences.theme.$value,
  })
  .from(users)
  .where(eq(profile.user.preferences.theme.$text, 'dark'))
```

### Update nested JSONB values atomically

```typescript
await db
  .update(users)
  .set({
    profile: json(users.profile).$pipe(
      (s) => s.user.preferences.$default({ theme: 'light', tags: [] }),
      (s) => s.user.name.$set('Jane'),
      (s) => s.user.preferences.theme.$set('dark'),
      (s) => s.user.preferences.tags['0'].$set('intro'),
    ),
  })
  .where(eq(users.id, darkUsers[0]!.id))
```

Each `$pipe(...)` step sees the JSONB expression produced by the previous step. `json.pipe(source, ...steps)` is the namespace form of the same API.

### Use SQL values inside JSON updates

```typescript
import { eq, sql } from 'drizzle-orm'

await db
  .update(users)
  .set({
    profile: json(users.profile)
      .metadata.$default({})
      .lastLogin.$set(sql`now()::text`),
  })
  .where(eq(users.id, darkUsers[0]!.id))
```

### Build and merge JSONB in an update

```typescript
import { eq, sql } from 'drizzle-orm'

await db
  .update(users)
  .set({
    profile: json.merge(
      users.profile,
      json.build({
        metadata: {
          importedAt: sql`now()::text`,
          source: 'api',
        },
      }),
    ),
  })
  .where(eq(users.id, darkUsers[0]!.id))
```

### Update JSON arrays

```typescript
const tags = json(users.profile).user.preferences.tags.$value

await db
  .update(users)
  .set({
    profile: json(users.profile).user.preferences.tags.$set(
      json.arrayPush(tags, 'drizzle'),
    ),
  })
  .where(eq(users.id, darkUsers[0]!.id))
```

## Helper Map

| Helper                                                | What it does                                       | Notes                                                                   |
| ----------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------- |
| `json(source)`                                        | Callable typed ref API                             | Primary API for path access, updates, containment, and pipes            |
| `json(source).$path` / `path(source)`                 | Typed SQL/JSON path queries                        | Filters array items and object values; `$exists` is GIN-indexable       |
| `json.path(source, { mode: 'strict' })`               | The same builder in strict mode                    | Raises on missing keys; `$deep` yields no duplicates                    |
| `json(source).$path...$rows(alias, columns)`          | One row per yielded item, as a lateral subquery    | Columns are typed refs to the item                                      |
| `json(source).path.$number` / `.$boolean`             | Extract a JSON number or boolean as a SQL scalar   | JSON `null` and missing keys become SQL `NULL`                          |
| `access(source)`                                      | Deprecated path extraction                         | Use `json(source).path.$value` or `.$text`                              |
| `set(source)`                                         | Deprecated single-update builder                   | Use `json(source).path.$set(...)` or `.$default(...)`                   |
| `pipe(source, ...ops)` / `json(source).$pipe(...ops)` | Chain multiple JSON updates                        | Each step sees the previous result                                      |
| `setPipe(source, ...ops)`                             | Deprecated chain helper                            | Use `json(source).$pipe(...)` or `json.pipe(source, ...)`               |
| `build(value)`                                        | Convert JS values and SQL snippets into JSONB SQL  | Handles nested arrays, objects, and SQL expressions                     |
| `coalesce(source, fallback)`                          | Replace SQL `NULL` and JSON `null` with a fallback | Useful before updates                                                   |
| `contains(source)` / `contains(source, value)`        | Deprecated containment builder                     | Use `json(source).path.$contains(...)` or `json(source).$contains(...)` |
| `merge(left, right)`                                  | Apply PostgreSQL JSONB `\|\|` semantics            | SQL `NULL` is normalized to JSON `null` first                           |
| `arrayPush(target, ...values)`                        | Append values to a JSON array                      | Nullish arrays become `[]`; `undefined` becomes JSON `null`             |
| `arraySet(target, index, value)`                      | Replace an element at an index                     | Nullish arrays become `[]`; out-of-bounds indexes are no-ops            |
| `arrayDelete(target, index)`                          | Remove an element at an index                      | Nullish arrays become `[]`; out-of-bounds indexes are no-ops            |

## Important Behavior

### Callable refs are the primary API

`json(source)` returns a typed ref. Use normal property access for JSON keys, `.$value` for JSONB extraction, and `.$text` for text extraction.

```typescript
const profile = json(users.profile)

profile.user.name.$value
profile.user.name.$text
profile.user.preferences.tags[0].$value
```

Refs also build updates and predicates:

```typescript
await db.update(users).set({
  profile: profile.$pipe(
    (p) => p.metadata.$default({ importedAt: 'fallback' }),
    (p) => p.user.name.$set('Ada'),
    (p) => p.user.preferences.tags.$push('drizzle'),
    (p) => p.metadata.$merge({ source: 'api' }),
  ),
})

profile.metadata.$coalesce({ importedAt: 'unknown' })
profile.user.preferences.$contains({ theme: 'dark' })
profile.user.preferences.tags[0].$delete()
```

Use `.$key(name)` for JSON keys that collide with helper names, including `$value`, `$set`, and `$contains`.

```typescript
json(users.profile).config.$key('$value').$text
```

### Containment keeps queries index-friendly

Use `.$contains(...)` for JSONB `@>` predicates that should use a full-column GIN or `jsonb_path_ops` index.

```typescript
await db
  .select({ id: users.id })
  .from(users)
  .where(json(users.profile).user.preferences.$contains({ theme: 'dark' }))
```

It emits a root containment predicate:

```sql
profile @> '{"user":{"preferences":{"theme":"dark"}}}'::jsonb
```

Call it on the root ref when you already have the full containment shape:

```typescript
json(users.profile).$contains({
  user: { preferences: { theme: 'dark' } },
})
```

Do not use `json(users.profile).user.preferences.$value @> ...` when you expect a full-column JSONB index to be used. That filters on `jsonb_extract_path(...)`, so it needs an expression index on the extracted path instead.

### Compare extracted values by their type

`.$value` is a JSONB expression, so Drizzle binds the other side of a comparison as JSONB too. A plain string is not valid JSON input, and ranges follow JSONB ordering, which sorts across JSON types:

```typescript
const profile = json(users.profile)

// Fails: invalid input syntax for type json
eq(profile.user.preferences.theme.$value, 'dark')
// Runs, but also matches the strings "1", JSON null, and []
lt(json(reports.result).audits.$key('fcp').score.$value, 3)
```

Compare with the accessor that matches the JSON type instead:

```typescript
eq(profile.user.preferences.theme.$text, 'dark')
eq(profile.user.preferences.theme.$value, json.build('dark'))
lt(json(reports.result).audits.$key('fcp').score.$number, 0.9)
```

- `.$number` emits `nullif(jsonb_extract_path(...), 'null'::jsonb)::float8` and decodes to a JS `number`. It is offered only where the JSON type is `number` (or `unknown`).
- `.$boolean` does the same with `::boolean`, on `boolean` paths.
- Missing keys, JSON `null`, and a SQL `NULL` source all return SQL `NULL`, on every supported PostgreSQL version.
- A value of another JSON type is an error, not `NULL`: the cast does not coerce `"2.5"` into `2.5`.
- `float8` rather than `numeric` keeps the result a JS `number`; drivers decode `numeric` as a string. Use `.$text` when you need the exact decimal digits.

### Query JSON paths with `$path`

`json(source).$path` builds a typed, read-only [SQL/JSON path](https://www.postgresql.org/docs/current/functions-json.html#FUNCTIONS-SQLJSON-PATH) in lax mode. It reaches what refs cannot: every item of an array, every value of an object map, values at any depth, and items that match a condition. Everything works on every supported PostgreSQL version (14+) except `$valueAs(...)`, which needs PostgreSQL 17. `json.path(source)` is the same builder, and `json.path(source, { mode: 'strict' })` builds it in strict mode.

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

const reports = pgTable('reports', {
  id: serial('id').primaryKey(),
  result: jsonb('result').$type<Report>().notNull(),
})

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
    failingIds: failing.id.$query, // SQL<string[]>
    firstClickX: report.events.$each.$match({ kind: 'click' }).x.$first, // SQL<number | null>
  })
  .from(reports)
  .where(failing.$exists)
```

Navigate:

| Step               | jsonpath       | Yields                                                                                                 |
| ------------------ | -------------- | ------------------------------------------------------------------------------------------------------ |
| `.key`             | `."key"`       | The property                                                                                           |
| `[n]`              | `[n]`          | One array item                                                                                         |
| `$each`            | `[*]`          | Every array item                                                                                       |
| `$values`          | `.*`           | Every value of an object or `Record`                                                                   |
| `$entries`         | `.keyvalue()`  | `{ key, value, id }` for every member, keeping map keys; non-objects such as JSON `null` yield nothing |
| `$deep`            | `.**`          | The item and every value nested in it, at any depth, typed `unknown`                                   |
| `$key(name)`       | `."name"`      | Any key: `Record` keys, numeric-looking keys, `$`-names                                                |
| `$filter(fn)`      | `? (...)`      | The items the predicate accepts                                                                        |
| `$match({ k: v })` | `? (@.k == v)` | The items with those scalar values; narrows union types                                                |

Finish with a terminal:

- `.$exists` emits `source @? path`. It can use a full-column GIN index.
- `.$query` emits `jsonb_path_query_array(source, path)`: every yielded item, `[]` when nothing matches, SQL `NULL` when the source is SQL `NULL`.
- `.$first` emits `jsonb_path_query_first(source, path)`: the first item, or SQL `NULL` when nothing matches. A matched JSON `null` stays JSON `null`.
- `.$count` counts the yielded items, JSON `null` included; it is `0` when nothing matches or the source is SQL `NULL`.
- `.$sum`, `.$avg`, `.$min`, and `.$max` are offered on number paths. They ignore JSON `null` and return SQL `NULL` when no number is left. Each one is a scalar subquery over `jsonb_path_query(...)`; to compute several, or to group and filter, use `$rows(...)` with Drizzle's aggregate helpers.
- `.$test((node, p) => ...)` emits `source @@ predicate`, where `node` stands for the current path. Unlike `$filter(...).$exists`, it keeps an unknown result as SQL `NULL`, for example a comparison between a string and a number. A callback that returns `undefined` tests `true`.
- `.$valueAs(type, { onEmpty?, onError? })` emits `JSON_VALUE(source, path RETURNING type)` and needs **PostgreSQL 17+**. `type` is `'text'`, `'integer'`, `'double precision'`, or `'boolean'`. It converts the single scalar the path yields, numeric and boolean strings included (`"7"` becomes `7`). It returns SQL `NULL` when nothing matches, more than one item does, the item is an object or array, or the conversion fails; pass `'error'` to raise instead. Defaults are not supported (PostgreSQL only accepts constants there); wrap the result in `coalesce(...)`.
- `.$rows(alias, columns)` turns the items into rows; see below.

Inside `$filter((node, p) => ...)`, `node` is the item being tested (`@`). Build predicates on it and its paths:

- `$eq`, `$ne`, `$in([...])` take scalar values of the path's type; `$in([])` matches nothing.
- `$lt`, `$lte`, `$gt`, `$gte` are offered on number and string paths.
- `$startsWith(prefix)` and `$regex(pattern, flags?)` are offered on string paths. `$regex` is PostgreSQL's `like_regex` (POSIX), with flags made of `i`, `m`, `s`, and `q`.
- `$exists` tests that a path yields an item; `$isNull` tests for a present JSON `null`.
- `p.and(...)`, `p.or(...)`, and `p.not(...)` combine predicates and skip `undefined`, so JS-side conditions read inline. When nothing is left, the filter is dropped.
- `p.sql(value)` compares against a SQL value instead of a literal: a column, or `sql<T>` with a type. It is passed as a jsonpath variable (`$v1`) built with `jsonb_build_object(...)`, so untyped parameters need a cast (`` sql<number>`${min}::float8` ``). SQL `NULL` becomes JSON `null`, which `$eq` matches against stored JSON nulls. A path with a variable can't use the `@?`/`@@` operators, so `$exists` and `$test` switch to `jsonb_path_exists(...)` / `jsonb_path_match(...)`, which no index serves.

```typescript
const thresholds = pgTable('thresholds', {
  reportId: integer('report_id').notNull(),
  minScore: doublePrecision('min_score').notNull(),
})

const belowThreshold = json(reports.result).$path.audits.$values.$filter(
  (audit, p) => audit.score.$lt(p.sql(thresholds.minScore)),
)

await db
  .select({ id: reports.id, failing: belowThreshold.$count })
  .from(reports)
  .innerJoin(thresholds, eq(thresholds.reportId, reports.id))
  .where(belowThreshold.$exists)
```

Path semantics to keep in mind:

- Comparisons are type-strict: the string `"5"` neither equals nor is less than the number `5`, and a comparison against a missing key never matches. `$ne(x)` means "some item differs from `x`", which is not the same as `p.not(node.$eq(x))`.
- Two conditions on `node.items.$each.a` and `node.items.$each.b` may match different items. To require both on the same item, nest a filter: `node.items.$each.$filter((item, p) => p.and(item.a.$eq(1), item.b.$eq(1))).$exists`.
- Arrays need `$each` before `$filter(...)` or `$match(...)`: lax mode unwraps arrays, so a filter on the array itself would test its items.
- A JSON `null` stored where an array is declared counts as a one-item array, so `$each` and `[n]` yield `null` for it; their item types include `null` when the array is nullable.
- Values are written into the path as JSON literals, and the whole path is one bound parameter. Only JS scalars and `p.sql(...)` variables are accepted. A predicate only works inside the callback that built it.
- Lax `$deep` yields an item twice when the descent passes through arrays. That doesn't matter for `$exists`, but it does for `$query` and aggregates; use strict mode for those.
- `$path` is only available on the root ref. Numeric property names are array indexes; use `$key('0')` for an object key named `"0"`.

#### Strict mode

`json.path(source, { mode: 'strict' })` prefixes the path with `strict`. A missing key or an array where an object was expected raises an error in `$query`, `$first`, `$count` and the other aggregates, `$rows`, and `$valueAs`, instead of yielding nothing. `$exists` and `$test` return SQL `NULL` in that case, so `$exists` is typed `boolean | null`. Steps right after `$deep` still skip items that lack the key, so strict mode is the way to collect values at any depth without duplicates:

```typescript
json.path(reports.result, { mode: 'strict' }).$deep.$key('score').$query
// strict $.**."score"
```

#### Turn JSON into rows with `$rows`

`$rows(alias, (item, ordinality) => columns)` yields one row per item as a Drizzle subquery over `jsonb_path_query(...)`. `item` is a typed ref to the item, so columns are built with `$text`, `$number`, `$boolean`, and `$value`; `ordinality` is the item's 1-based position. Join it with `crossJoinLateral(...)`, or `leftJoinLateral(..., sql\`true\`)` to keep rows that have no items:

```typescript
const audits = json(reports.result).$path.audits.$entries.$rows(
  'audits',
  (entry, ordinality) => ({
    key: entry.key.$text,
    score: entry.value.score.$number,
    mode: entry.value.mode.$text,
    ordinality,
  }),
)

await db
  .select({ id: reports.id, numeric: count(), average: avg(audits.score) })
  .from(reports)
  .crossJoinLateral(audits)
  .where(eq(audits.mode, 'numeric'))
  .groupBy(reports.id)
```

```sql
select ... from "reports"
cross join lateral (
  select jsonb_extract_path_text("jsonb_path_items".item, 'key') as "key", ...
  from jsonb_path_query("reports"."result", $1::text::jsonpath)
    with ordinality as "jsonb_path_items"(item, ord)
) "audits"
```

A source that does not reference a table, such as a bound JSON value, can go straight into `.from(...)`. With `leftJoinLateral`, Drizzle types the columns of a partial selection as non-null, but rows without items come back with SQL `NULL` in every column; test `ordinality` for `null` to find them.

This is a deliberate subset of PostgreSQL 17's `JSON_TABLE`, which is not wrapped: `JSON_TABLE` only accepts a constant path, so it can't take the path as a bound parameter, and it needs PostgreSQL 17. `$rows` works on 14+. Typed refs take the place of `JSON_TABLE` column types, and a second `$rows(...)` over a column of the first takes the place of `NESTED PATH`, except that sibling nested paths multiply rows instead of combining them.

### Indexes for JSON queries

An expression index is only used when the query contains the same expression. Declare the index from the same ref the queries use, and the expressions match by construction:

```typescript
const reports = pgTable(
  'reports',
  {
    id: serial('id').primaryKey(),
    result: jsonb('result').$type<Report>().notNull(),
  },
  // Inside this callback, drizzle types the columns without their JSON type,
  // so read the outer table (and annotate the return type).
  (): IndexBuilder[] => [
    index('reports_result_gin').using('gin', reports.result),
    index('reports_fcp_score').on(
      json(reports.result).audits.$key('fcp').score.$number,
    ),
  ],
)

await db
  .select()
  .from(reports)
  .where(lt(json(reports.result).audits.$key('fcp').score.$number, 0.9))
```

An index on `result->>'kind'` is not used for `json(reports.result).kind.$text`, which emits `jsonb_extract_path_text(result, 'kind')`. Changing either side to match the other is enough.

For `$contains(...)`, `$path.$exists`, and `$path.$test(...)`, a full-column GIN index serves every path that has no `p.sql(...)` variable. What it narrows depends on the operator class:

| Predicate                                                    | `jsonb_ops` (default) | `jsonb_path_ops` (smaller) |
| ------------------------------------------------------------ | --------------------- | -------------------------- |
| `$contains(...)`                                             | Narrows               | Narrows                    |
| `$path` equality (`$eq`, `$in`, `$match`), including `$each` | Narrows               | Narrows                    |
| `$path` equality below `$values` or `$deep`                  | Narrows               | Scans the whole index      |
| Ranges, `$startsWith`, `$regex`, existence-only paths        | Scans the whole index | Scans the whole index      |
| Anything below `$entries`                                    | Scans the whole index | Scans the whole index      |

Combine a selective equality with a range in one filter to keep the index useful. Planner row estimates for `@>` and `@?` do not reflect the data; for extracted scalars, an expression index or `create statistics ... on (expression) from table` (PostgreSQL 14+) followed by `analyze` gives the planner real estimates.

### Access is typed, but schema-free

You do not provide runtime schemas. The path is built through a `Proxy`, and TypeScript keeps the path typed from the column or `SQL<T>` source.

```typescript
const accessor = json(users.profile)

accessor.user.name.$value
accessor.user.name.$text
accessor.user.preferences.tags['0'].$value
```

- `.$value` returns a JSONB expression.
- `.$text` returns a text expression.

### `$default(...)` is for missing intermediate branches

`jsonb_set(..., create_missing := true)` only creates the last missing segment. If an earlier branch is missing, PostgreSQL leaves the target unchanged.

Use `.$default(...)` on optional or nullable branches before deeper updates.

```typescript
const safeUpdate = json(users.profile)
  .user.preferences.$default({ theme: 'light', tags: [] })
  .theme.$set('dark')
```

Without `.$default(...)`, the update can silently do nothing when the intermediate object is missing.

`.$default(...)` is also the explicit way to initialize a SQL `NULL` root before writing nested fields. Without it, SQL `NULL` stays SQL `NULL`.

```typescript
await db.update(users).set({
  profile: json(users.profile).$pipe(
    (s) => s.user.$default({ name: 'New User' }),
    (s) => s.user.name.$set('Ada'),
  ),
})
```

Do not rely on `.$pipe(...)` to turn a SQL `NULL` root into `{}` automatically. Add the default at the branch you want to create.

### Array helpers have distinct write semantics

Use `arrayPush(...)` when you want append behavior.

```typescript
const tags = json(users.profile).user.preferences.tags.$value

await db.update(users).set({
  profile: json(users.profile).user.preferences.tags.$set(
    json.arrayPush(tags, 'drizzle', 'postgres'),
  ),
})
```

Use `arraySet(...)` when you want to replace an existing element.

```typescript
await db.update(users).set({
  profile: json(users.profile).user.preferences.tags.$set(
    json.arraySet(tags, 0, 'intro'),
  ),
})
```

- `arrayPush(...)` appends every value in order.
- `arraySet(...)` uses PostgreSQL `jsonb_set(..., false)`, so out-of-bounds indexes are no-ops.
- `arrayDelete(...)` removes an existing element; out-of-bounds indexes are no-ops.
- All array helpers treat SQL `NULL` and JSON `null` targets as `[]`.
- `arrayPush(...)` and `arraySet(...)` convert JavaScript `undefined` to JSON `null`.
- `arraySet(...)` and `arrayDelete(...)` require an integer index and throw otherwise.

### Null handling is deliberate

The helpers do not all treat nullish values the same way.

- `.$text`, `.$number`, and `.$boolean` return SQL `NULL` when the property is missing, JSON `null`, or the source itself is SQL `NULL`.
- `.$value` returns SQL `NULL` when the property is missing or the source is SQL `NULL`, but JSON `null` for a JSON `null` property. Both decode to a JS `null`.
- `$path.$query` returns `[]` when nothing matches; `$path.$first` returns SQL `NULL`.
- `coalesce(...)` treats both SQL `NULL` and JSON `null` as empty and returns the fallback.
- `arrayPush(...)`, `arraySet(...)`, and `arrayDelete(...)` treat nullish array targets as `[]`.
- `merge(...)` normalizes SQL `NULL` to JSON `null` before applying PostgreSQL `||` semantics.
- `.$set(...)`, `.$default(...)`, and `arraySet(...)` write JSON `null` at the path when a SQL value evaluates to SQL `NULL`, instead of letting `jsonb_set` turn the whole document into SQL `NULL`.

That behavior is useful, but it also means `merge(...)` is not a plain wrapper around `left || right` when SQL `NULL` is involved.

### Build once, reuse everywhere

`build(...)` accepts plain JS values, nested objects, arrays, and SQL expressions, then turns them into JSONB SQL.

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

That makes it a good companion for `json(source)`, `pipe(...)`, and `merge(...)`.

SQL expressions are a trust boundary. Plain JavaScript values are always bound as query parameters, so user input should normally be passed as plain values:

```typescript
json.build({
  label: userInput,
})
```

Use `sql\`...\``only when you intentionally want PostgreSQL to compute the value. When a computed SQL expression is embedded into JSONB, helpers wrap it with`to_jsonb(...)` so PostgreSQL writes the expression result as a JSON value instead of trying to place a raw SQL scalar where JSONB is required.

```typescript
json.build({
  metadata: {
    importedAt: sql`now()::text`,
    rowId: users.id,
  },
})
```

This produces JSON with values computed by PostgreSQL, while any interpolated values inside the SQL snippet still use Drizzle parameters. `sql.raw(...)` remains caller-controlled SQL and should not contain untrusted input.

## Common Patterns

### Select nested data

```typescript
const profile = json(users.profile)

const rows = await db
  .select({
    name: profile.user.name.$text,
    theme: profile.user.preferences.theme.$value,
  })
  .from(users)
```

### Update one path

```typescript
await db
  .update(users)
  .set({
    profile: json(users.profile).user.preferences.theme.$set('dark'),
  })
  .where(eq(users.id, userId))
```

### Update several paths in one expression

```typescript
await db.update(users).set({
  profile: json(users.profile).$pipe(
    (s) => s.user.name.$set('Den'),
    (s) => s.user.preferences.$default({ theme: 'light', tags: [] }),
    (s) => s.user.preferences.tags['0'].$set('postgres'),
  ),
})
```

### Merge overlay data

```typescript
await db.update(users).set({
  profile: json.merge(
    users.profile,
    json.build({
      metadata: { importedAt: '2026-03-15T09:30:00Z' },
    }),
  ),
})
```

### Work with arrays

```typescript
const tags = json(users.profile).user.preferences.tags.$value

await db.update(users).set({
  profile: json(users.profile).user.preferences.tags.$set(
    json.arrayPush(tags, 'drizzle'),
  ),
})
```

## Minimal Reference

### Namespace methods

- `json(source)`
- `json.access(source)` deprecated; use `json(source).path.$value` / `.$text`
- `json.arrayDelete(source, index)`
- `json.arrayPush(source, ...values)`
- `json.arraySet(source, index, value)`
- `json.build(value)`
- `json.coalesce(source, fallback)`
- `json.contains(source)` / `json.contains(source, value)` deprecated; use `json(source).path.$contains(...)`
- `json.merge(left, right)`
- `json.path(source)`, the same builder as `json(source).$path`
- `json.pipe(source, ...operations)`
- `json.set(source)` deprecated; use `json(source).path.$set(...)`
- `json.setPipe(source, ...operations)` deprecated; use `json(source).$pipe(...)`

### Direct operation exports

- `access` from `@denny-il/drizzle-pg-utils/json` (deprecated)
- `arrayDelete`, `arrayPush`, `arraySet` from `@denny-il/drizzle-pg-utils/json`
- `build` from `@denny-il/drizzle-pg-utils/json`
- `coalesce` from `@denny-il/drizzle-pg-utils/json`
- `contains` from `@denny-il/drizzle-pg-utils/json` (deprecated)
- `merge` from `@denny-il/drizzle-pg-utils/json`
- `path` from `@denny-il/drizzle-pg-utils/json`
- `pipe`, `set`, `setPipe` from `@denny-il/drizzle-pg-utils/json`; `set` and `setPipe` are deprecated

### Per-operation subpaths

- `@denny-il/drizzle-pg-utils/json/access` (deprecated)
- `@denny-il/drizzle-pg-utils/json/array`
- `@denny-il/drizzle-pg-utils/json/build`
- `@denny-il/drizzle-pg-utils/json/coalesce`
- `@denny-il/drizzle-pg-utils/json/contains` (deprecated)
- `@denny-il/drizzle-pg-utils/json/merge`
- `@denny-il/drizzle-pg-utils/json/path`
- `@denny-il/drizzle-pg-utils/json/set` (`jsonSet` is deprecated)
