/// <reference types="temporal-spec/global" />
import {
  createInterval,
  type TemporalIntervalType,
} from '../columns/interval.ts'

export const interval: TemporalIntervalType = createInterval(
  globalThis.Temporal,
)
