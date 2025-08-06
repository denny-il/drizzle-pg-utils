import { Temporal } from 'temporal-polyfill'
import {
  createInterval,
  type TemporalIntervalType,
} from '../columns/interval.ts'

export const interval: TemporalIntervalType = createInterval(Temporal)
