# JSON Utilities

Type-safe utilities for working with PostgreSQL JSONB data in Drizzle ORM applications.

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Installation & Imports](#installation--imports)
- [Core Functions](#core-functions)
  - [JSON Accessor](#json-accessor)
  - [JSON Setter](#json-setter)
  - [JSON Set Pipe](#json-set-pipe)
  - [JSON Merge](#json-merge)
  - [JSON Build](#json-build)
  - [JSON Coalesce](#json-coalesce)
  - [Array Operations](#array-operations)
- [Type Safety](#type-safety)
- [PostgreSQL Compatibility](#postgresql-compatibility)
- [Migration from Raw SQL](#migration-from-raw-sql)
- [API Reference](#api-reference)

## Features

- 🎯 **Type-safe JSONB operations** - Full TypeScript support with proper type inference
- 🔍 **JSON accessor** - Navigate nested JSON structures with dot notation WITHOUT any runtime schema
- ✏️ **JSON setter** - Update JSON values at specific paths with default value support for optional properties
- 🔄 **JSON merge** - Merge JSON objects and arrays following PostgreSQL semantics
- 📦 **Array operations** - Push, set, and delete array elements
- 🛡️ **Null safety** - Proper handling of SQL NULL and JSON null values
- ⚠️ **Compatibility** - Requires runtime with [Proxy](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy#browser_compatibility) support

## Quick Start

Here's a quick example to get you started:

```typescript
import { jsonb, pgTable, serial, text } from 'drizzle-orm/pg-core'
import json from '@denny-il/drizzle-pg-utils/json'

// Define your table with JSONB column
const users = pgTable('users', {
  id: serial('id').primaryKey(),
  profile: jsonb('profile').$type<{
    name: string
    preferences: { theme: 'light' | 'dark' }
  }>()
})

// Access nested values
const userTheme = json.access(users.profile).preferences.theme.$value

// Update nested values
const updatedProfile = json.set(users.profile).preferences.theme.$set('dark')

// Merge objects
const merged = json.merge(users.profile, sql`'{"lastLogin": "2024-01-01"}'::jsonb`)
```

## Installation & Imports

```typescript
// JSON utilities only
import { access, merge, array, setPipe, build, coalesce } from '@denny-il/drizzle-pg-utils/json'
// or
import json from '@denny-il/drizzle-pg-utils/json'

// Main export - includes JSON utilities only
import { json } from '@denny-il/drizzle-pg-utils'
```

## Core Functions

### JSON Accessor

Access nested properties in JSONB columns with type safety:

```typescript
import { sql } from 'drizzle-orm'
import json from '@denny-il/drizzle-pg-utils/json'

// Define your JSON type
type UserProfile = {
  user: {
    id: number
    name: string
    profile: {
      avatar: string
      preferences: {
        theme: 'light' | 'dark'
        notifications: boolean
      }
    }
  }
  tags: string[]
}

const jsonData = sql<UserProfile>`'{"user": {"id": 1, "name": "John", "profile": {"avatar": "url", "preferences": {"theme": "dark", "notifications": true}}}, "tags": ["tag1", "tag2"]}'::jsonb`

// Access nested properties
const accessor = json.access(jsonData)

// Get the user's name
const userName = accessor.user.name.$value  // Returns value as string (jsonb_extract_path_text, or '->> operator)
const userPath = accessor.user.name.$path   // Returns value as jsonb (jsonb_extract_path, or '-> operator)

// Access deeply nested values
const theme = accessor.user.profile.preferences.theme.$value
const notifications = accessor.user.profile.preferences.notifications.$value

// Access arrays
const tags = accessor.tags.$value
```

### JSON Setter

Update specific paths in JSONB data:

```typescript
import { sql } from 'drizzle-orm'
import json from '@denny-il/drizzle-pg-utils/json'

const jsonData = sql<UserProfile>`'{"user": {"id": 1, "name": "John"}}'::jsonb`
const setter = json.set(jsonData)

// Set a simple value
const updatedName = setter.user.name.$set('Jane')

// Set a complex object
const updatedProfile = setter.user.profile.$set({
  avatar: 'new-avatar.jpg',
  preferences: {
    theme: 'light',
    notifications: false
  }
})

// Set with createMissing parameter (default: true)
const setWithoutCreating = setter.user.newField.$set('value', false)

// Set default values for optional properties (only available on nullable/optional fields)
const setterWithDefault = setter.optionalProperty
  .$default({ key: 'defaultValue' })  // Set default if property is null/missing
  .key.$set('actualValue')            // Then continue with normal setting

// Real-world example with optional user profile
type UserData = {
  id: number
  name: string
  profile?: {
    avatar?: string
    preferences?: {
      theme: 'light' | 'dark'
      notifications: boolean
    }
  }
}

const userData = sql<UserData>`'{"id": 1, "name": "John"}'::jsonb`
const userSetter = json.set(userData)

// Initialize optional profile with defaults, then set specific values
const withProfile = userSetter.profile
  .$default({
    avatar: '/default-avatar.png',
    preferences: { theme: 'light', notifications: true }
  })
  .preferences.theme.$set('dark')
```

#### Why `$default`?

The `$default` method solves a limitation of PostgreSQL's `jsonb_set` function. While `jsonb_set` has a `create_missing` parameter, it only creates the **last missing portion** of the path. If intermediate path segments are missing, `jsonb_set` returns the target unchanged. See the [PostgreSQL documentation](https://www.postgresql.org/docs/current/functions-json.html#:~:text=jsonb_set) for details.

The `$default` method works around this by:
1. Using `jsonb_extract_path` to check if the intermediate path exists
2. Using `json_query` with `coalesce` to provide a default structure if missing
3. Then allowing normal `$set` operations on the now-guaranteed-to-exist structure

```typescript
// Without $default - this might fail to set the value if 'profile' or 'preferences' doesn't exist
setter.profile.preferences.theme.$set('dark')

// With $default - this always works
setter.profile
  .$default({ preferences: { } })
  .preferences.theme.$set('dark')
```

### JSON Set Pipe

Chain multiple JSONB set operations together for complex updates:

```typescript
import { sql } from 'drizzle-orm'
import { jsonSetPipe } from '@denny-il/drizzle-pg-utils/json'

const userData = sql<UserProfile>`'{"user": {"id": 1, "name": "John"}}'::jsonb`

// Chain multiple updates together
const updated = jsonSetPipe(
  userData,
  // First update: set the user name
  (setter) => setter.user.name.$set('Jane'),
  // Second update: add profile data (operates on result of first update)
  (setter) => setter.user.profile.$set({
    avatar: 'avatar.jpg',
    preferences: { theme: 'dark', notifications: true }
  }),
  // Third update: set last login (operates on result of second update)
  (setter) => setter.lastLogin.$set('2023-12-01T10:00:00Z')
)
// Result: Complete UserProfile object with all updates applied sequentially

// Use with database updates for complex multi-field changes
await db
  .update(users)
  .set({
    profile: jsonSetPipe(
      users.profile,
      (setter) => setter.user.name.$set('Updated Name'),
      (setter) => setter.user.profile.preferences.theme.$set('light'),
      (setter) => setter.lastLogin.$set(new Date().toISOString())
    )
  })
  .where(eq(users.id, 1))
```

### JSON Merge

Merge JSON objects and arrays following PostgreSQL JSONB semantics:

```typescript
import { sql } from 'drizzle-orm'
import json from '@denny-il/drizzle-pg-utils/json'

const obj1 = sql`'{"a": "hello", "b": 1}'::jsonb`
const obj2 = sql`'{"b": 2, "c": true}'::jsonb`

// Merge objects (right takes precedence on duplicate keys)
const merged = json.merge(obj1, obj2)
// Result: {"a": "hello", "b": 2, "c": true}

// Merge arrays
const arr1 = sql`'[1, 2]'::jsonb`
const arr2 = sql`'[3, 4]'::jsonb`
const mergedArray = json.merge(arr1, arr2)
// Result: [1, 2, 3, 4]

// Mix types (creates arrays)
const mixed = json.merge(sql`'"hello"'::jsonb`, arr1)
// Result: ["hello", 1, 2]
```

### JSON Build

Build JSONB values from TypeScript objects and arrays:

```typescript
import { sql } from 'drizzle-orm'
import json from '@denny-il/drizzle-pg-utils/json'

// Build object from properties
const builtObject = json.build.object({
  name: 'John',
  age: 30,
  active: true
})
// Result: {"name": "John", "age": 30, "active": true}

// Build array from values
const builtArray = json.build.array(['item1', 'item2', 42])
// Result: ["item1", "item2", 42]

// Mix with SQL expressions
const dynamicObject = json.build.object({
  timestamp: sql`NOW()`,
  userId: sql`${users.id}`,
  static: 'value'
})

// Nested structures
const nestedStructure = json.build.object({
  user: json.build.object({
    id: 1,
    profile: json.build.object({
      settings: json.build.array(['setting1', 'setting2'])
    })
  })
})
```

### JSON Coalesce

Handle null values in JSONB data with type-safe coalescing:

```typescript
import { sql } from 'drizzle-orm'
import json from '@denny-il/drizzle-pg-utils/json'

const possiblyNullJson = sql<{ name?: string } | null>`'{"name": null}'::jsonb`

// Coalesce with fallback object
const withFallback = json.coalesce(
  possiblyNullJson,
  json.build.object({ name: 'Default Name' })
)

// Coalesce specific properties
const userName = json.coalesce(
  json.access(users.profile).name.$path,
  sql`'"Anonymous"'::jsonb`
)

// Chain with other operations
const safeUpdate = json.set(
  json.coalesce(users.profile, json.build.object({ preferences: {} }))
).preferences.theme.$set('dark')
```

### Array Operations

Manipulate JSONB arrays:

```typescript
import { sql } from 'drizzle-orm'
import json from '@denny-il/drizzle-pg-utils/json'

const numberArray = sql<number[]>`'[1, 2, 3]'::jsonb`

// Push values to array
const withPushed = json.array.push(numberArray, 4, 5)
// Result: [1, 2, 3, 4, 5]

// Set value at specific index
const withSet = json.array.set(numberArray, 1, 99)
// Result: [1, 99, 3]

// Delete element at index
const withDeleted = json.array.delete(numberArray, 0)
// Result: [2, 3]
```

## Type Safety

All JSON functions provide full TypeScript support:

- **Input types are validated at compile time** - TypeScript ensures your JSON schema matches the operations you're performing
- **Return types are properly inferred** - The library correctly infers return types based on your input JSON schema
- **Nested property access maintains type safety** - Deep object navigation preserves type information at every level
- **SQL NULL vs JSON null handling is type-aware** - Proper distinction between SQL NULL and JSON null values
- **`$default` method is only available on optional/nullable properties** - TypeScript prevents misuse of default values on required properties
- **Type inference works correctly through `$default` chains** - Complex nested default operations maintain accurate type information

## PostgreSQL Compatibility

The JSON utilities target PostgreSQL 12+ and use standard functions:

- **`jsonb_extract_path()` and `jsonb_extract_path_text()`** - For accessing nested properties (equivalent to `->` and `->>` operators)
- **`jsonb_set()`** - For updating values at specific paths
- **`||` operator** - For merging JSONB objects and arrays
- **`jsonb_build_array()` and `jsonb_build_object()`** - For constructing new JSONB values
- **`COALESCE()`** - For null handling in JSON operations

## Migration from Raw SQL

If you're currently using raw PostgreSQL JSON operators, here's how to migrate to the type-safe utilities:

### Before (Raw SQL)

```typescript
// Raw JSON access
sql`${users.profile} -> 'user' -> 'name'`
sql`${users.profile} #>> '{user,profile,preferences,theme}'`

// Raw JSON updates
sql`jsonb_set(${users.profile}, '{user,name}', '"New Name"')`

// Raw JSON merge
sql`${users.profile} || '{"lastLogin": "2024-01-01"}'::jsonb`

// Raw array operations
sql`jsonb_set(${users.profile}, '{tags}', (${users.profile} -> 'tags') || '"new-tag"'::jsonb)`
```

### After (Type-safe utilities)

```typescript
// Type-safe access with IntelliSense
json.access(users.profile).user.name.$path
json.access(users.profile).user.profile.preferences.theme.$value

// Type-safe updates with validation
json.set(users.profile).user.name.$set('New Name')

// Type-safe merge
json.merge(users.profile, json.build.object({ lastLogin: '2024-01-01' }))

// Type-safe array operations
json.array.push(json.access(users.profile).tags.$path, 'new-tag')
```

### Benefits of Migration

- **Type Safety**: Catch errors at compile time instead of runtime
- **IntelliSense**: Auto-completion for JSON paths and methods
- **Null Safety**: Automatic handling of SQL NULL vs JSON null
- **Readability**: More expressive and self-documenting code
- **Maintainability**: Easier refactoring when JSON schema changes

## API Reference

### `json.access(source)`

Creates a type-safe accessor for navigating JSONB structures.

- **Parameters:**
  - `source`: JSONB column or SQL expression
- **Returns:** Proxy object with type-safe property access
- **Properties:**
  - `.$value`: Extract the value as `text` (using `jsonb_extract_path_text`, equivalent to `->>` operator)
  - `.$path`: Extract the value as `jsonb` (using `jsonb_extract_path`, equivalent to `->` operator)

### `json.set(source)`

Creates a setter for updating JSONB values at specific paths.

- **Parameters:**
  - `source`: JSONB column or SQL expression
- **Returns:** Proxy object with `$set` and `$default` methods
- **Methods:**
  - `.$set(value, createMissing?)`: Update the value at this path
  - `.$default(value, createMissing?)`: Set a default value if the property is null/missing, then return a setter for further property access (only available on optional properties)

**Note:** The `$default` method is essential for setting values in deeply nested optional structures because PostgreSQL's `jsonb_set` only creates the last missing portion of a path. If intermediate path segments don't exist, `jsonb_set` returns the target unchanged. `$default` ensures the intermediate structure exists before attempting further operations.

### `json.setPipe(source, ...operations)`

Chains multiple JSONB set operations together in a pipeline.

- **Parameters:**
  - `source`: Initial JSONB column or SQL expression
  - `operations`: Functions that take a setter and return SQL expressions with updates
- **Returns:** SQL expression with all updates applied sequentially
- **Usage:** Each operation receives the result of the previous operation, allowing for complex multi-step updates in a single expression

### `json.merge(left, right)`

Merges two JSONB values following PostgreSQL semantics.

- **Parameters:**
  - `left`: First JSONB value
  - `right`: Second JSONB value
- **Returns:** SQL expression with merged result

### `json.build.object(obj)`

Builds a JSONB object from a TypeScript object.

- **Parameters:**
  - `obj`: Object with string keys and JSON-compatible values
- **Returns:** SQL expression representing the JSONB object
- **Usage:** Supports nested objects, arrays, and SQL expressions as values

### `json.build.array(arr)`

Builds a JSONB array from a TypeScript array.

- **Parameters:**
  - `arr`: Array of JSON-compatible values
- **Returns:** SQL expression representing the JSONB array
- **Usage:** Supports nested structures and SQL expressions as elements

### `json.coalesce(source, fallback)`

Returns the first non-null JSONB value, handling both SQL NULL and JSON null.

- **Parameters:**
  - `source`: Primary JSONB value (may be null)
  - `fallback`: Fallback JSONB value to use if source is null
- **Returns:** SQL expression with the coalesced result
- **Usage:** Essential for handling optional JSONB columns safely

### `json.array.push(source, ...values)`

Appends values to a JSONB array.

- **Parameters:**
  - `source`: JSONB array
  - `values`: Values to append
- **Returns:** SQL expression with updated array

### `json.array.set(source, index, value)`

Sets a value at a specific array index.

- **Parameters:**
  - `source`: JSONB array
  - `index`: Zero-based index
  - `value`: New value
- **Returns:** SQL expression with updated array

### `json.array.delete(source, index)`

Removes an element at a specific array index.

- **Parameters:**
  - `source`: JSONB array
  - `index`: Zero-based index to remove
- **Returns:** SQL expression with updated array
