# JSON Ref API

Use `json(source)` as the primary API. It returns a typed ref: navigate JSON paths with normal property access, then finish with a `$`-operation.

## Imports

```typescript
import { json } from '@denny-il/drizzle-pg-utils'
// or: import { json } from '@denny-il/drizzle-pg-utils/json'
// or: import { jsonRef, jsonRefPipe } from '@denny-il/drizzle-pg-utils/json/ref'
```

## Read

```typescript
const profile = json(users.profile)

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

- `.$value` extracts JSONB; `.$text` extracts text. Refs are also SQL expressions themselves (`getSQL()`), so a bare ref can be used where Drizzle accepts SQL; prefer the explicit terminals in examples.
- Rewrap an extracted subdocument as a new root when needed: `json(profile.user.preferences.$value).theme.$value`.

## Write

Every mutation returns the full updated document for the root source, ready for `db.update(...).set({...})`:

```typescript
await db
  .update(users)
  .set({ profile: profile.user.preferences.theme.$set('dark') })
  .where(eq(users.id, userId))
```

- `.$set(value, createMissing?)` writes one path (`createMissing` defaults to `true` for the final segment).
- `.$delete()` removes the path.
- `.$push(...values)` appends to an array path; SQL `NULL` and JSON `null` targets become `[]`.
- `.$merge(value)` applies JSONB `||` at the path; missing and JSON `null` targets are treated as `{}`.
- `.$coalesce(fallback)` reads the path with a fallback for SQL `NULL` / JSON `null`.
- `.$default(value)` fills a missing or null intermediate branch, then continues navigation: `profile.metadata.$default({}).lastLogin.$set(...)`. It is only offered on nullable object paths.

## Chain with `$pipe`

Use `$pipe` (root only) when later writes depend on earlier writes. Each step receives a ref over the previous result:

```typescript
await db.update(users).set({
  profile: json(users.profile).$pipe(
    (s) => s.user.preferences.$default({ theme: 'light', tags: [] }),
    (s) => s.user.preferences.theme.$set('dark'),
    (s) => s.user.preferences.tags.$push('drizzle'),
  ),
})
```

A step must return a finished SQL expression or a `$default(...)` continuation. `json.pipe(source, ...ops)` is the equivalent standalone form. `setPipe(...)` is deprecated in favor of `$pipe`.

## Containment

`.$contains(value)` stays rooted at the original source, so full-column GIN / `jsonb_path_ops` indexes apply:

```typescript
profile.user.preferences.$contains({ theme: 'dark' })
// emits: profile @> '{"user":{"preferences":{"theme":"dark"}}}'::jsonb
```

- SQL containment values are only accepted at the root ref; nested paths take plain values (enforced at the type level).
- Containment below an array index is a type error by design: JSONB `@>` cannot address array positions. Filter on the array path itself, e.g. `profile.user.preferences.tags.$contains(['drizzle'])`.

## Reserved Keys and Dynamic Paths

Property names starting with `$` (plus `getSQL`, `toString`, `valueOf`) are helper operations. For data keys with those names, or for dynamic segments, use `.$key(name)`:

```typescript
json(users.profile).config.$key('$value').$text
json(users.profile).$key(dynamicSegment).$value
```

Path segments and values stay safely encoded regardless of content: segments are escaped as SQL literals, values are parameterized.
