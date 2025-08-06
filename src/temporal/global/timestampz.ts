/// <reference types="temporal-spec/global" />
import {
  createTimestampz,
  registerZonedDateTimeJSONFix,
  type TemporalTimestampzType,
} from '../columns/timestampz.ts'

export const timestampz: TemporalTimestampzType = createTimestampz(
  globalThis.Temporal,
)

export function _registerZonedDateTimeJSONFix() {
  return registerZonedDateTimeJSONFix(globalThis.Temporal)
}
