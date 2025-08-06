import 'temporal-polyfill/global'
import { describe, expect, it } from 'vitest'

describe('Temporal Global ', async () => {
  const columns = await import('../../src/temporal/global.ts')

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
