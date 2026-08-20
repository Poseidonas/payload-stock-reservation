import type { Payload } from 'payload'

import { availableFrom } from './availability.js'
import { resolveConfig } from './config.js'
import type { StockTarget } from './holds.js'
import { readActiveHolds } from './holds.js'
import type { ResolvedConfig, StockReservationConfig } from './types.js'

export type StockSnapshot = {
  inventory: null | number
  price: null | number
}

export const priceFieldName = (currency: string): string => `priceIn${currency.toUpperCase()}`

const numberOrNull = (value: unknown): null | number =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

export const readStock = async (
  payload: Payload,
  config: ResolvedConfig,
  target: StockTarget,
  currency: string,
): Promise<null | StockSnapshot> => {
  const select: Record<string, true> = { [config.inventoryFieldName]: true }

  if (currency) {
    select[priceFieldName(currency)] = true
  }

  const doc = await payload.findByID({
    id: target.id,
    collection: target.collection,
    depth: 0,
    disableErrors: true,
    overrideAccess: true,
    select,
  })

  if (!doc) {
    return null
  }

  const record = doc as Record<string, unknown>

  return {
    inventory: numberOrNull(record[config.inventoryFieldName]),
    price: currency ? numberOrNull(record[priceFieldName(currency)]) : null,
  }
}

/**
 * Stock a shopper can actually buy right now: recorded inventory minus every
 * hold that has not expired. Returns null when the document does not exist or
 * does not track stock, which the official plugin treats as unlimited.
 */
export const availableStock = async (
  payload: Payload,
  target: { collection: string; document: number | string },
  options: StockReservationConfig = {},
): Promise<null | number> => {
  const config = resolveConfig(options)
  const resolved: StockTarget = {
    collection: target.collection,
    document: String(target.document),
    id: target.document,
  }

  const snapshot = await readStock(payload, config, resolved, '')

  if (!snapshot || snapshot.inventory === null) {
    return null
  }

  const holds = await readActiveHolds(payload, config, resolved, new Date())

  return availableFrom(snapshot.inventory, holds)
}
