---
name: drizzle-pg-utils
description: Answer questions about the @denny-il/drizzle-pg-utils and help build complex JSON queries with Drizzle ORM, PostgreSQL JSONB helper usage and Temporal column mapping.
---

# Drizzle PG Utils

Prefer practical Drizzle query examples using public package imports. Avoid `src/` internals. Show helpers inside `db.select(...)`, `db.update(...)`, and `db.insert(...)` when possible.

## Supported Drivers

Requires drizzle-orm `1.0.0-rc.6`. Supported: node-postgres, postgres-js, PGlite, and drizzle's own Postgres driver (`drizzle-orm/postgres`, `/postgres/effect`, `/postgres/pglite`). bun-sql, effect-postgres and effect-pglite are not supported: point users to `drizzle-orm/postgres`, `drizzle-orm/postgres/effect` or `drizzle-orm/postgres/pglite` instead (details in references/temporal.md, Driver Notes).

## References

- Read [references/json.md](references/json.md) first for JSONB helper routing, import styles, and common rules. Then load the focused file under `references/json/` for the helper family being used: the callable `json(source)` ref API (primary), access, updates/defaults, arrays, containment, or build/coalesce/merge.
- Read [references/temporal.md](references/temporal.md) for Temporal helpers: entrypoint choice, column mapping, factories, constraints, interval setup, SQL expressions, query examples, and driver notes (supported drivers and migration, per-connection `intervalstyle`, decoding raw SQL, known driver limitations).
