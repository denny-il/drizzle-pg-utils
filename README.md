# Drizzle PostgreSQL Utils

A TypeScript library providing type-safe utilities for working with PostgreSQL JSONB data and Temporal types in Drizzle ORM applications.

## Features

### JSON Utilities
- 🎯 **Type-safe JSONB operations** - Full TypeScript support with proper type inference
- 🔍 **JSON accessor** - Navigate nested JSON structures with dot notation WITHOUT any runtime schema
- ✏️ **JSON setter** - Update JSON values at specific paths with default value support for optional properties
- 🔄 **JSON merge** - Merge JSON objects and arrays following PostgreSQL semantics
- 📦 **Array operations** - Push, set, and delete array elements
- 🛡️ **Null safety** - Proper handling of SQL NULL and JSON null values
- ⚠️ **Compatibility** - Requires runtime with [Proxy](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy#browser_compatibility) support

### Temporal Utilities
- ⏰ **[Temporal API](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal) support** - Modern date/time API
- 📅 **PostgreSQL integration** - Direct mapping between Temporal types and PostgreSQL date/time types
- 🔧 **Custom column types** - Ready-to-use Drizzle column definitions
- ✅ **Type safety** - Full TypeScript support for all temporal operations
- 🛡️ **Format validation** - Built-in constraints for text-based temporal types
- ⚠️ **Compatibility** - Two options available: globally available Temporal API or via [temporal-polyfill](https://github.com/fullcalendar/temporal-polyfill) package

## Quick Start

### Installation

```bash
npm install @denny-il/drizzle-pg-utils
```

### JSON Utilities

```typescript
import json from '@denny-il/drizzle-pg-utils/json'

// Access nested properties with type safety
const accessor = json.access(users.profile)
const theme = accessor.user.preferences.theme.$value

// Update values at specific paths
const setter = json.set(users.profile)
const updated = setter.user.name.$set('New Name')
```

### Temporal Utilities

```typescript
import { timestamp, timestampz } from '@denny-il/drizzle-pg-utils/temporal'

const events = pgTable('events', {
  id: serial('id').primaryKey(),
  scheduledAt: timestamp.column('scheduled_at'),
  createdAt: timestampz.column('created_at'),
})
```

## Installation

```bash
npm install @denny-il/drizzle-pg-utils
# or
pnpm add @denny-il/drizzle-pg-utils
# or
yarn add @denny-il/drizzle-pg-utils
```

## Exports Structure

This library provides modular exports for different functionality:

```typescript
// Main export - includes JSON utilities only
import { json } from '@denny-il/drizzle-pg-utils'

// JSON utilities only
import { access, merge, array, setPipe } from '@denny-il/drizzle-pg-utils/json'
// or
import json from '@denny-il/drizzle-pg-utils/json'

// Temporal utilities (globally registered Temporal)
import * as temporal from '@denny-il/drizzle-pg-utils/temporal'

// Temporal utilities (with polyfill)
import * as temporal from '@denny-il/drizzle-pg-utils/temporal/polyfill'
```

Each export is independently importable, allowing you to include only what you need in your bundle.

## Documentation

- **[JSON Utilities](./doc/json.md)** - Complete guide to JSON/JSONB operations
- **[Temporal Utilities](./doc/temporal.md)** - Working with PostgreSQL date/time types using Temporal API

## License

MIT License - see [LICENSE.md](LICENSE.md) for details.
