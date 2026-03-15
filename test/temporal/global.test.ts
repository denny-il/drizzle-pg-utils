import { describe, expect, it } from 'vitest'

describe('Temporal Global ', async () => {
  const columns = await import('@denny-il/drizzle-pg-utils/temporal/global')

  it('should work', () => {
    expect(columns).toBeDefined()
    expect(columns.plainDate).toBeDefined()
    expect(columns.time).toBeDefined()
    expect(columns.timestamp).toBeDefined()
    expect(columns.timestampz).toBeDefined()
    expect(columns.yearMonth).toBeDefined()
    expect(columns.monthDay).toBeDefined()
    expect(columns.interval).toBeDefined()
  })
})
