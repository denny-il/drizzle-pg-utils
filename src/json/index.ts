import { jsonAccess } from './access.ts'
import { jsonArrayDelete, jsonArrayPush, jsonArraySet } from './array.ts'
import { jsonMerge } from './merge.ts'
import { jsonSet, jsonSetPipe } from './set.ts'

const access = jsonAccess
const merge = jsonMerge
const set = jsonSet
const setPipe = jsonSetPipe
const array = {
  delete: jsonArrayDelete,
  push: jsonArrayPush,
  set: jsonArraySet,
}

export { access, array, merge, set, setPipe }
export default { access, merge, set, setPipe, array }
