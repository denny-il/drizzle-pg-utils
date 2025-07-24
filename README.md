# Drizzle PostgreSQL Utils

A TypeScript library providing type-safe utilities for working with PostgreSQL JSONB data in Drizzle ORM applications.

## Features

- 🎯 **Type-safe JSONB operations** - Full TypeScript support with proper type inference
- 🔍 **JSON accessor** - Navigate nested JSON structures with dot notation
- ✏️ **JSON setter** - Update JSON values at specific paths
- 🔄 **JSON merge** - Merge JSON objects and arrays following PostgreSQL semantics
- 📦 **Array operations** - Push, set, and delete array elements
- 🛡️ **Null safety** - Proper handling of SQL NULL vs JSON null values

## Installation

```bash
npm install @project/drizzle-utils
# or
pnpm add @project/drizzle-utils
# or
yarn add @project/drizzle-utils
```

## Usage

### JSON Accessor

Access nested properties in JSONB columns with type safety:

```typescript
import { sql } from 'drizzle-orm'
import { json } from '@project/drizzle-utils'

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
const userName = accessor.user.name.$value  // Returns SQL<string>
const userPath = accessor.user.name.$path   // Returns the JSONB path

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
import { json } from '@project/drizzle-utils'

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
```

### JSON Merge

Merge JSON objects and arrays following PostgreSQL JSONB semantics:

```typescript
import { sql } from 'drizzle-orm'
import { json } from '@project/drizzle-utils'

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

### Array Operations

Manipulate JSONB arrays:

```typescript
import { sql } from 'drizzle-orm'
import { json } from '@project/drizzle-utils'

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

### Working with Database Columns

Use with actual Drizzle table columns:

```typescript
import { jsonb, pgTable, serial, text } from 'drizzle-orm/pg-core'
import { json } from '@project/drizzle-utils'

const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  profile: jsonb('profile').$type<UserProfile>()
})

// In your queries
const user = await db
  .select({
    id: users.id,
    name: users.name,
    theme: json.access(users.profile).user.profile.preferences.theme.$value
  })
  .from(users)
  .where(eq(users.id, 1))

// Update queries
await db
  .update(users)
  .set({
    profile: json.set(users.profile).user.name.$set('New Name')
  })
  .where(eq(users.id, 1))

// Merge updates
await db
  .update(users)
  .set({
    profile: json.merge(
      users.profile,
      sql`'{"user": {"lastLogin": "2023-12-01"}}'::jsonb`
    )
  })
  .where(eq(users.id, 1))
```

## API Reference

### `json.access(source)`

Creates a type-safe accessor for navigating JSONB structures.

- **Parameters:**
  - `source`: JSONB column or SQL expression
- **Returns:** Proxy object with type-safe property access
- **Properties:**
  - `.$value`: Extract the value as text (using `jsonb_extract_path_text`)
  - `.$path`: Extract the JSONB value (using `jsonb_extract_path`)

### `json.set(source)`

Creates a setter for updating JSONB values at specific paths.

- **Parameters:**
  - `source`: JSONB column or SQL expression
- **Returns:** Proxy object with `$set` methods
- **Method:**
  - `.$set(value, createMissing?)`: Update the value at this path

### `json.merge(left, right)`

Merges two JSONB values following PostgreSQL semantics.

- **Parameters:**
  - `left`: First JSONB value
  - `right`: Second JSONB value
- **Returns:** SQL expression with merged result

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

## Type Safety

All functions provide full TypeScript support:

- Input types are validated at compile time
- Return types are properly inferred based on the input JSON schema
- Nested property access maintains type safety
- SQL NULL vs JSON null handling is type-aware

## PostgreSQL Compatibility

This library targets PostgreSQL 12+ and uses standard JSONB functions:

- `jsonb_extract_path()` and `jsonb_extract_path_text()` for access
- `jsonb_set()` for updates
- `||` operator for merging
- `jsonb_build_array()` and `jsonb_build_object()` for construction

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for your changes
4. Run the test suite: `pnpm test`
5. Submit a pull request

## License

MIT License - see LICENSE.md for details