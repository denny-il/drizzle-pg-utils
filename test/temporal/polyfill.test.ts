import { describe, expect, it } from 'vitest'

describe('Temporal Polyfill', async () => {
  const columns = await import('../../src/temporal/polyfill')

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
