import { is, SQL, type SQLWrapper } from 'drizzle-orm'

/**
 * Embeds `.as(...)` expressions as their SQL. Drizzle renders an aliased
 * expression as its alias name, which only resolves in a select list.
 * Subquery and view fields are also `SQL.Aliased`, but marked as selection
 * fields: those aliases are real column references and stay as-is.
 */
export function jsonSource<Source extends SQLWrapper>(
  source: Source,
): Source | SQL {
  if (
    is(source, SQL.Aliased) &&
    !(source as SQL.Aliased & { isSelectionField?: boolean }).isSelectionField
  )
    return source.sql
  return source
}
