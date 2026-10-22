// Temporal uses astronomical ISO years (including year zero and signed
// six-digit years); PostgreSQL uses unsigned years and a trailing BC era.
export function toPostgresDateTime(value: string): string {
  return value.replace(/^([+-]?\d{4,6})(-.*)$/, (_, year, rest) => {
    const isoYear = Number(year)
    const pgYear = isoYear <= 0 ? 1 - isoYear : isoYear
    return `${String(pgYear).padStart(4, '0')}${rest}${isoYear <= 0 ? ' BC' : ''}`
  })
}

export function fromPostgresDateTime(value: string): string {
  const bc = value.endsWith(' BC')
  const dateTime = bc ? value.slice(0, -3) : value
  // A leading `-` is a signed astronomical year, which @effect/sql-pg emits
  // for dates it decodes itself (`-0001-03-04` for PostgreSQL's
  // `0002-03-04 BC`). PostgreSQL's own output never has one.
  return dateTime.replace(/^(-?)(\d+)(-.*)$/, (_, sign, year, rest) => {
    const isoYear = sign ? -Number(year) : bc ? 1 - Number(year) : Number(year)
    const iso =
      isoYear < 0
        ? `-${String(-isoYear).padStart(6, '0')}`
        : isoYear > 9999
          ? `+${String(isoYear).padStart(6, '0')}`
          : String(isoYear).padStart(4, '0')
    return `${iso}${rest}`
  })
}

export function toPostgresInterval(value: string): string {
  return value.startsWith('-')
    ? value.slice(1).replace(/\d+(?:\.\d+)?/g, '-$&')
    : value
}

// PostgreSQL signs each field (`P-1DT-3H`); Temporal uses one leading sign
// (`-P1DT3H`). Mixed-sign intervals have no Temporal form and are passed
// through for Temporal.Duration.from to reject.
export function fromPostgresInterval(value: string): string {
  const parts = value.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? []
  if (!parts.some((part) => part < 0) || parts.some((part) => part > 0))
    return value
  return `-${value.replaceAll('-', '')}`
}
