import { ObjectId } from 'mongodb'

export function toObjectId(value: unknown) {
  if (typeof value !== 'string' || !ObjectId.isValid(value)) {
    return null
  }

  return new ObjectId(value)
}
