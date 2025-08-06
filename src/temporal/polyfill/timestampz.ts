import { Temporal } from 'temporal-polyfill'
import {
  createTimestampz,
  registerZonedDateTimeJSONFix,
  type TemporalTimestampzType,
} from '../columns/timestampz.ts'

export const timestampz: TemporalTimestampzType = createTimestampz(Temporal)

export function _registerZonedDateTimeJSONFix() {
  return registerZonedDateTimeJSONFix(Temporal)
}
