import type { CollectionConfig, Payload } from 'payload'

import { resolveConfig } from './config.js'
import type { ResolvedConfig, StockHold, StockReservationConfig } from './types.js'

export type StockTarget = {
  collection: string
  document: string
  id: number | string
}

export const holdsCollection = (config: ResolvedConfig): CollectionConfig => ({
  slug: config.holdsSlug,
  access: {
    create: () => false,
    delete: () => false,
    read: () => false,
    update: () => false,
  },
  admin: {
    hidden: true,
  },
  fields: [
    {
      name: 'cart',
      type: 'text',
      index: true,
      required: true,
    },
    {
      name: 'stockCollection',
      type: 'text',
      index: true,
      required: true,
    },
    {
      name: 'stockDocument',
      type: 'text',
      index: true,
      required: true,
    },
    {
      name: 'quantity',
      type: 'number',
      min: 1,
      required: true,
    },
    {
      name: 'expiresAt',
      type: 'date',
      index: true,
      required: true,
    },
  ],
})

const asString = (value: unknown): string => {
  if (typeof value === 'string') {
    return value
  }

  return typeof value === 'number' ? String(value) : ''
}

const asIso = (value: unknown): string => {
  if (value instanceof Date) {
    return value.toISOString()
  }

  return typeof value === 'string' ? value : ''
}

export const toHold = (doc: unknown): null | StockHold => {
  if (typeof doc !== 'object' || doc === null) {
    return null
  }

  const record = doc as Record<string, unknown>
  const id = asString(record.id)

  if (!id) {
    return null
  }

  return {
    cart: asString(record.cart),
    createdAt: asIso(record.createdAt),
    expiresAt: asIso(record.expiresAt),
    id,
    quantity: typeof record.quantity === 'number' ? record.quantity : 0,
    stockCollection: asString(record.stockCollection),
    stockDocument: asString(record.stockDocument),
  }
}

export const readActiveHolds = async (
  payload: Payload,
  config: ResolvedConfig,
  target: StockTarget,
  now: Date,
): Promise<StockHold[]> => {
  const result = await payload.find({
    collection: config.holdsSlug,
    depth: 0,
    limit: config.holdScanLimit,
    overrideAccess: true,
    sort: 'createdAt',
    where: {
      and: [
        { stockCollection: { equals: target.collection } },
        { stockDocument: { equals: target.document } },
        { expiresAt: { greater_than: now.toISOString() } },
      ],
    },
  })

  return result.docs.map(toHold).filter((hold): hold is StockHold => hold !== null)
}

export const createHold = async (
  payload: Payload,
  config: ResolvedConfig,
  args: { cart: string; expiresAt: Date; quantity: number; target: StockTarget },
): Promise<null | StockHold> => {
  const created = await payload.create({
    collection: config.holdsSlug,
    data: {
      cart: args.cart,
      expiresAt: args.expiresAt.toISOString(),
      quantity: args.quantity,
      stockCollection: args.target.collection,
      stockDocument: args.target.document,
    },
    depth: 0,
    overrideAccess: true,
  })

  return toHold(created)
}

export const deleteHolds = async (
  payload: Payload,
  config: ResolvedConfig,
  ids: string[],
): Promise<number> => {
  if (ids.length === 0) {
    return 0
  }

  const result = await payload.delete({
    collection: config.holdsSlug,
    depth: 0,
    overrideAccess: true,
    where: { id: { in: ids } },
  })

  return result.docs.length
}

export const releaseCartHolds = async (
  payload: Payload,
  config: ResolvedConfig,
  cart: string,
): Promise<number> => {
  const result = await payload.delete({
    collection: config.holdsSlug,
    depth: 0,
    overrideAccess: true,
    where: { cart: { equals: cart } },
  })

  return result.docs.length
}

export const sweepExpired = async (
  payload: Payload,
  config: ResolvedConfig,
  documents: string[],
  now: Date,
): Promise<number> => {
  if (documents.length === 0) {
    return 0
  }

  const result = await payload.delete({
    collection: config.holdsSlug,
    depth: 0,
    overrideAccess: true,
    where: {
      and: [
        { stockDocument: { in: documents } },
        { expiresAt: { less_than_equal: now.toISOString() } },
      ],
    },
  })

  return result.docs.length
}

/**
 * Deletes every hold whose lifetime has run out and returns how many were
 * removed. Safe to call at any time and from anywhere: expired holds are
 * already excluded from availability, so this only keeps the collection small.
 */
export const releaseExpiredHolds = async (
  payload: Payload,
  options: StockReservationConfig = {},
): Promise<number> => {
  const config = resolveConfig(options)

  const result = await payload.delete({
    collection: config.holdsSlug,
    depth: 0,
    overrideAccess: true,
    where: { expiresAt: { less_than_equal: new Date().toISOString() } },
  })

  return result.docs.length
}
