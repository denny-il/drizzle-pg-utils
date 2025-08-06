/// <reference types="temporal-spec/global" />
import { createTime, type TemporalTimeType } from '../columns/time.ts'

export const time: TemporalTimeType = createTime(globalThis.Temporal)
