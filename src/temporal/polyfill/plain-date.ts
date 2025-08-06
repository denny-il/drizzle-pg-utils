import { Temporal } from 'temporal-polyfill'
import {
  createPlainDate,
  type TemporalPlainDateType,
} from '../columns/plain-date.ts'

export const plainDate: TemporalPlainDateType = createPlainDate(Temporal)
