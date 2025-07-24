import { jsonAccessor } from './access.ts'
import { jsonArrayDelete, jsonArrayPush, jsonArraySet } from './array.ts'
import { jsonMerge } from './merge.ts'
import { jsonSet } from './set.ts'

export const json = {
  access: jsonAccessor,
  merge: jsonMerge,
  set: jsonSet,
  array: {
    delete: jsonArrayDelete,
    push: jsonArrayPush,
    set: jsonArraySet,
  },
}

export default json
