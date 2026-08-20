import type { Payload, PayloadRequest } from 'payload'

export type Doc = Record<string, unknown>

export type FakeStore = Record<string, Doc[]>

export type Fake = {
  errors: unknown[]
  payload: Payload
  store: FakeStore
}

const compare = (value: unknown, condition: Doc): boolean => {
  if ('equals' in condition) {
    return String(value) === String(condition.equals)
  }

  if ('in' in condition) {
    return (condition.in as unknown[]).map(String).includes(String(value))
  }

  if ('greater_than' in condition) {
    return Date.parse(String(value)) > Date.parse(String(condition.greater_than))
  }

  if ('less_than_equal' in condition) {
    return Date.parse(String(value)) <= Date.parse(String(condition.less_than_equal))
  }

  return true
}

const matches = (doc: Doc, where: Doc): boolean => {
  if (Array.isArray(where.and)) {
    return (where.and as Doc[]).every((clause) => matches(doc, clause))
  }

  return Object.entries(where).every(([field, condition]) =>
    compare(doc[field], condition as Doc),
  )
}

export const createFake = (seed: FakeStore = {}): Fake => {
  const store: FakeStore = {}

  for (const [slug, docs] of Object.entries(seed)) {
    store[slug] = docs.map((doc) => ({ ...doc }))
  }

  const errors: unknown[] = []
  let counter = 0

  const payload = {
    create: ({ collection, data }: { collection: string; data: Doc }) => {
      counter += 1

      const doc: Doc = {
        ...data,
        createdAt: new Date(1_700_000_000_000 + counter).toISOString(),
        id: `hold-${counter}`,
      }

      store[collection] = [...(store[collection] ?? []), doc]

      return Promise.resolve(doc)
    },
    delete: ({ collection, where }: { collection: string; where: Doc }) => {
      const docs = store[collection] ?? []
      const removed = docs.filter((doc) => matches(doc, where))

      store[collection] = docs.filter((doc) => !matches(doc, where))

      return Promise.resolve({ docs: removed, errors: [] })
    },
    find: ({ collection, limit, where }: { collection: string; limit?: number; where?: Doc }) => {
      const docs = (store[collection] ?? []).filter((doc) => (where ? matches(doc, where) : true))

      return Promise.resolve({ docs: typeof limit === 'number' ? docs.slice(0, limit) : docs })
    },
    findByID: ({ collection, id }: { collection: string; id: number | string }) =>
      Promise.resolve((store[collection] ?? []).find((doc) => String(doc.id) === String(id)) ?? null),
    logger: {
      error: (value: unknown) => {
        errors.push(value)
      },
    },
  }

  return { errors, payload: payload as unknown as Payload, store }
}

export const jsonRequest = (fake: Fake, body: Doc, user: Doc | null = null): PayloadRequest => {
  const text = JSON.stringify(body)

  return {
    headers: new Headers({ 'content-type': 'application/json' }),
    payload: fake.payload,
    text: () => Promise.resolve(text),
    user,
  } as unknown as PayloadRequest
}

export const hold = (values: Partial<Doc> & { id: string }): Doc => ({
  cart: 'cart-other',
  createdAt: new Date(1_600_000_000_000).toISOString(),
  expiresAt: new Date(4_000_000_000_000).toISOString(),
  quantity: 1,
  stockCollection: 'variants',
  stockDocument: 'v1',
  ...values,
})
