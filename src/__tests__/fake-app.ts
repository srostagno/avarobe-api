// A Fastify app stand-in with in-memory collections, for tests of the
// background jobs (color read retries, alerts) without a database. The
// collections understand the small part of MongoDB those jobs use: filters
// with dotted paths, null matching a missing field, $exists, $ne, $in, $nin,
// $lt/$lte/$gt/$gte, $or, $nor and $and; updates with $set, $unset, $inc and
// $setOnInsert, pipeline $set with $ifNull and $min, upserts (and their duplicate-key
// error, on _id and on the unique fields of UNIQUE: avatars.userId, as in
// plugins/mongodb.ts) and sort/limit. Anything else throws, so a test never
// passes on a query the fake didn't understand.
import type { FastifyInstance } from 'fastify'
import { ObjectId } from 'mongodb'

export type Doc = Record<string, unknown>

const isPlain = (value: unknown): value is Doc =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  !(value instanceof Date) &&
  !(value instanceof ObjectId) &&
  !Buffer.isBuffer(value)

const isOperators = (value: unknown): value is Doc =>
  isPlain(value) && Object.keys(value).length > 0 && Object.keys(value).every((key) => key.startsWith('$'))

export function clone<T>(value: T): T {
  if (value instanceof Date) {
    return new Date(value.getTime()) as T
  }

  if (Array.isArray(value)) {
    return value.map((item: unknown) => clone(item)) as T
  }

  if (isPlain(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) as T
  }

  return value
}

export function read(doc: Doc, path: string): unknown {
  let value: unknown = doc

  for (const key of path.split('.')) {
    if (!isPlain(value)) {
      return undefined
    }

    value = value[key]
  }

  return value
}

function write(doc: Doc, path: string, value: unknown) {
  const keys = path.split('.')
  let target = doc

  for (const key of keys.slice(0, -1)) {
    if (!isPlain(target[key])) {
      target[key] = {}
    }

    target = target[key] as Doc
  }

  target[keys[keys.length - 1]!] = value
}

function remove(doc: Doc, path: string) {
  const keys = path.split('.')
  const parent = keys.length > 1 ? read(doc, keys.slice(0, -1).join('.')) : doc

  if (isPlain(parent)) {
    delete parent[keys[keys.length - 1]!]
  }
}

function same(a: unknown, b: unknown): boolean {
  if (b === null) {
    return a === null || a === undefined
  }

  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime()
  }

  if (a instanceof ObjectId && b instanceof ObjectId) {
    return a.equals(b)
  }

  return a === b
}

// Ascending order, nulls first (as MongoDB sorts them).
function order(a: unknown, b: unknown) {
  const missing = (value: unknown) => (value === null || value === undefined ? 0 : 1)

  if (missing(a) !== missing(b)) {
    return missing(a) - missing(b)
  }

  const key = (value: unknown) => (value instanceof Date ? value.getTime() : typeof value === 'number' ? value : String(value))
  const [x, y] = [key(a), key(b)]

  return x < y ? -1 : x > y ? 1 : 0
}

function test(value: unknown, condition: unknown): boolean {
  if (!isOperators(condition)) {
    return same(value, condition)
  }

  const present = value !== null && value !== undefined

  return Object.entries(condition).every(([operator, argument]) => {
    switch (operator) {
      case '$exists':
        return (value !== undefined) === Boolean(argument)
      case '$ne':
        return !same(value, argument)
      case '$in':
        return (argument as unknown[]).some((item) => same(value, item))
      case '$nin':
        return !(argument as unknown[]).some((item) => same(value, item))
      case '$lt':
        return present && order(value, argument) < 0
      case '$lte':
        return present && order(value, argument) <= 0
      case '$gt':
        return present && order(value, argument) > 0
      case '$gte':
        return present && order(value, argument) >= 0
      default:
        throw new Error(`fake-app: filter operator ${operator} is not supported`)
    }
  })
}

export function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, condition]) => {
    if (key === '$or') {
      return (condition as Doc[]).some((part) => matches(doc, part))
    }

    if (key === '$nor') {
      return !(condition as Doc[]).some((part) => matches(doc, part))
    }

    if (key === '$and') {
      return (condition as Doc[]).every((part) => matches(doc, part))
    }

    if (key.startsWith('$')) {
      throw new Error(`fake-app: filter operator ${key} is not supported`)
    }

    return test(read(doc, key), condition)
  })
}

function evaluate(doc: Doc, expression: unknown): unknown {
  if (typeof expression === 'string' && expression.startsWith('$')) {
    return read(doc, expression.slice(1))
  }

  if (isPlain(expression) && Array.isArray(expression.$ifNull)) {
    const [value, fallback] = expression.$ifNull as unknown[]
    const resolved = evaluate(doc, value)

    return resolved === null || resolved === undefined ? evaluate(doc, fallback) : resolved
  }

  if (isPlain(expression) && Array.isArray(expression.$min)) {
    const values = (expression.$min as unknown[]).map((value) => evaluate(doc, value)).filter((value) => value !== null && value !== undefined)

    return values.length > 0 ? values.reduce((least, value) => (order(value, least) < 0 ? value : least)) : null
  }

  return expression
}

function applyUpdate(doc: Doc, update: Doc | Doc[], inserting = false) {
  if (Array.isArray(update)) {
    for (const stage of update) {
      for (const [path, expression] of Object.entries(stage.$set as Doc)) {
        write(doc, path, clone(evaluate(doc, expression)))
      }
    }

    return
  }

  for (const [operator, fields] of Object.entries(update)) {
    for (const [path, value] of Object.entries(fields as Doc)) {
      if (operator === '$set' || (operator === '$setOnInsert' && inserting)) {
        write(doc, path, clone(value))
      } else if (operator === '$unset') {
        remove(doc, path)
      } else if (operator === '$inc') {
        write(doc, path, ((read(doc, path) as number | undefined) ?? 0) + (value as number))
      } else if (operator !== '$setOnInsert') {
        throw new Error(`fake-app: update operator ${operator} is not supported`)
      }
    }
  }
}

const duplicateKey = () => Object.assign(new Error('E11000 duplicate key error'), { code: 11000 })

// Unique indexes besides _id, by collection.
const UNIQUE: Record<string, string[]> = { avatars: ['userId'] }

type FindOptions = { sort?: Record<string, 1 | -1>; limit?: number; projection?: unknown }

export class FakeCollection {
  docs: Doc[]
  private unique: string[]

  constructor(docs: Doc[] = [], unique: string[] = []) {
    this.docs = docs.map((doc) => clone(doc))
    this.unique = unique
  }

  private clashes(doc: Doc) {
    return this.docs.some(
      (existing) =>
        (doc._id !== undefined && same(existing._id, doc._id)) ||
        this.unique.some((field) => read(doc, field) !== undefined && same(read(existing, field), read(doc, field))),
    )
  }

  private select(filter: Doc, options: FindOptions = {}) {
    let rows = this.docs.filter((doc) => matches(doc, filter))

    if (options.sort) {
      const keys = Object.entries(options.sort)
      rows = [...rows].sort((a, b) => {
        for (const [key, direction] of keys) {
          const compared = order(read(a, key), read(b, key)) * direction

          if (compared !== 0) {
            return compared
          }
        }

        return 0
      })
    }

    return options.limit ? rows.slice(0, options.limit) : rows
  }

  private upsert(filter: Doc, update: Doc | Doc[]) {
    const seed: Doc = {}

    for (const [key, value] of Object.entries(filter)) {
      if (!key.startsWith('$') && !isOperators(value)) {
        write(seed, key, clone(value))
      }
    }

    applyUpdate(seed, update, true)

    if (this.clashes(seed)) {
      throw duplicateKey()
    }

    seed._id ??= new ObjectId()
    this.docs.push(seed)

    return seed
  }

  find(filter: Doc = {}, options: FindOptions = {}) {
    let { sort, limit } = options
    const cursor = {
      sort: (value: Record<string, 1 | -1>) => {
        sort = value
        return cursor
      },
      limit: (value: number) => {
        limit = value
        return cursor
      },
      toArray: async () => this.select(filter, { sort, limit }).map((doc) => clone(doc)),
    }

    return cursor
  }

  async findOne(filter: Doc = {}, _options?: unknown) {
    const doc = this.select(filter)[0]

    return doc ? clone(doc) : null
  }

  async countDocuments(filter: Doc = {}) {
    return this.select(filter).length
  }

  async distinct(field: string, filter: Doc = {}) {
    const values: unknown[] = []

    for (const doc of this.select(filter)) {
      const value = read(doc, field)

      if (!values.some((seen) => same(seen, value))) {
        values.push(value)
      }
    }

    return values
  }

  async insertOne(doc: Doc) {
    if (this.clashes(doc)) {
      throw duplicateKey()
    }

    const stored = clone(doc)
    stored._id ??= new ObjectId()
    this.docs.push(stored)

    return { acknowledged: true, insertedId: stored._id }
  }

  async deleteOne(filter: Doc) {
    const doc = this.select(filter)[0]
    this.docs = this.docs.filter((existing) => existing !== doc)

    return { deletedCount: doc ? 1 : 0 }
  }

  async deleteMany(filter: Doc) {
    const before = this.docs.length
    this.docs = this.docs.filter((doc) => !matches(doc, filter))

    return { deletedCount: before - this.docs.length }
  }

  async updateOne(filter: Doc, update: Doc | Doc[], options: { upsert?: boolean } = {}) {
    const doc = this.select(filter)[0]

    if (doc) {
      applyUpdate(doc, update)
      return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 }
    }

    if (options.upsert) {
      this.upsert(filter, update)
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 }
    }

    return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 }
  }

  async updateMany(filter: Doc, update: Doc | Doc[]) {
    const rows = this.select(filter)
    rows.forEach((doc) => applyUpdate(doc, update))

    return { matchedCount: rows.length, modifiedCount: rows.length }
  }

  async findOneAndUpdate(filter: Doc, update: Doc | Doc[], options: { upsert?: boolean; returnDocument?: 'before' | 'after' } = {}) {
    const doc = this.select(filter)[0]

    if (doc) {
      const before = clone(doc)
      applyUpdate(doc, update)
      return options.returnDocument === 'after' ? clone(doc) : before
    }

    if (options.upsert) {
      const created = this.upsert(filter, update)
      return options.returnDocument === 'after' ? clone(created) : null
    }

    return null
  }
}

export type LogLine = { level: string; msg: string; obj: unknown }

// The app, its collections (created on first use, seeded from `seed`) and
// every log line, to check what would have been emailed. Collections go by
// their name on app.collections (opsAlerts, analyticsEvents).
export function fakeApp(seed: Record<string, Doc[]> = {}) {
  const logs: LogLine[] = []
  const record =
    (level: string) =>
    (obj: unknown, msg?: string) => {
      logs.push({ level, msg: typeof obj === 'string' ? obj : (msg ?? ''), obj })
    }
  const log = {
    level: 'info',
    trace: record('trace'),
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    fatal: record('fatal'),
    silent: () => undefined,
    child: () => log,
  }
  const db = new Map<string, FakeCollection>()
  const collection = (name: string) => {
    let found = db.get(name)

    if (!found) {
      found = new FakeCollection(seed[name] ?? [], UNIQUE[name] ?? [])
      db.set(name, found)
    }

    return found
  }
  let tokens = 0
  const app = {
    log,
    collections: new Proxy({}, { get: (_target, name) => collection(String(name)) }),
    jwt: { sign: async () => `test-token-${++tokens}` },
    // Transactions run their work as it comes (the collections ignore the
    // session option), for the payment grants.
    mongoClient: {
      startSession: () => ({ withTransaction: async (work: () => Promise<unknown>) => work(), endSession: async () => undefined }),
    },
  }

  return { app: app as unknown as FastifyInstance, collection, logs }
}
