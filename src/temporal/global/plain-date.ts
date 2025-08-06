/// <reference types="temporal-spec/global" />
import {
  createPlainDate,
  type TemporalPlainDateType,
} from '../columns/plain-date.ts'

export const plainDate: TemporalPlainDateType = createPlainDate(
  globalThis.Temporal,
)
