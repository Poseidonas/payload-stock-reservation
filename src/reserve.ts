import type { Payload } from 'payload'

import { holdFits } from './availability.js'
import type { Refusal } from './errors.js'
import { refusal, refusalCodes } from './errors.js'
import type { StockTarget } from './holds.js'
import { createHold, deleteHolds, readActiveHolds, releaseCartHolds, sweepExpired } from './holds.js'
import { readStock } from './stock.js'
import type { ResolvedConfig } from './types.js'

export type CartLine = {
  product?: unknown
  quantity?: unknown
  variant?: unknown
}

export type CheckoutLine = {
  quantity: number
  target: StockTarget
}

export type ReserveOutcome = {
  held: string[]
  refusal: null | Refusal
}

const identifier = (value: unknown): null | number | string => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value !== '') {
    return value
  }

  if (typeof value === 'object' && value !== null) {
    return identifier((value as { id?: unknown }).id)
  }

  return null
}

export const toCheckoutLines = (items: CartLine[], config: ResolvedConfig): CheckoutLine[] => {
  const lines: CheckoutLine[] = []

  for (const item of items) {
    const variant = identifier(item.variant)
    const product = identifier(item.product)
    const id = variant ?? product

    if (id === null) {
      continue
    }

    const raw = typeof item.quantity === 'number' ? Math.trunc(item.quantity) : 1
    const quantity = raw > 0 ? raw : 1

    lines.push({
      quantity,
      target: {
        collection: variant === null ? config.productsSlug : config.variantsSlug,
        document: String(id),
        id,
      },
    })
  }

  return lines
}

const discardOwnHolds = async (
  payload: Payload,
  config: ResolvedConfig,
  held: string[],
): Promise<void> => {
  if (held.length === 0) {
    return
  }

  try {
    await deleteHolds(payload, config, held)
  } catch (error) {
    payload.logger.error({
      err: error,
      msg: 'payload-stock-reservation: could not discard the holds of an interrupted checkout, they will expire on their own',
    })
  }

  held.length = 0
}

/**
 * Validates every line of a cart against stock and price, then holds what it
 * validated. A hold is written first and checked afterwards against the other
 * holds on the same document, oldest first, so that of two checkouts racing
 * for the last unit exactly one keeps it.
 */
export const reserveCart = async (args: {
  cart: string
  config: ResolvedConfig
  currency: string
  items: CartLine[]
  payload: Payload
}): Promise<ReserveOutcome> => {
  const { cart, config, currency, items, payload } = args
  const lines = toCheckoutLines(items, config)
  const held: string[] = []

  if (lines.length === 0) {
    return { held, refusal: null }
  }

  const now = new Date()
  const expiresAt = new Date(now.getTime() + config.ttlSeconds * 1000)

  await releaseCartHolds(payload, config, cart)

  if (config.sweepOnCheckout) {
    await sweepExpired(
      payload,
      config,
      lines.map((line) => line.target.document),
      now,
    )
  }

  try {
    for (const line of lines) {
      const { quantity, target } = line
      const snapshot = await readStock(payload, config, target, currency)

      if (!snapshot) {
        return {
          held,
          refusal: refusal({
            code: refusalCodes.NotFound,
            collection: target.collection,
            document: target.document,
            message: `${target.collection} ${target.document} is no longer available.`,
            status: 404,
          }),
        }
      }

      if (currency && (snapshot.price === null || snapshot.price <= 0)) {
        return {
          held,
          refusal: refusal({
            code: refusalCodes.MissingPrice,
            collection: target.collection,
            document: target.document,
            message: `${target.collection} ${target.document} has no price in ${currency}.`,
          }),
        }
      }

      const inventory = snapshot.inventory

      if (inventory === null) {
        continue
      }

      if (inventory < 0 && config.refuseNegativeInventory) {
        return {
          held,
          refusal: refusal({
            code: refusalCodes.NegativeInventory,
            collection: target.collection,
            document: target.document,
            message: `${target.collection} ${target.document} is recorded as oversold and cannot be sold until its stock is corrected.`,
          }),
        }
      }

      if (quantity > inventory) {
        return {
          held,
          refusal: refusal({
            code: refusalCodes.OutOfStock,
            collection: target.collection,
            document: target.document,
            message: `Only ${inventory > 0 ? inventory : 0} left of ${target.collection} ${target.document}.`,
          }),
        }
      }

      const hold = await createHold(payload, config, { cart, expiresAt, quantity, target })

      if (!hold) {
        throw new Error(`payload-stock-reservation: could not write a hold for ${target.document}`)
      }

      held.push(hold.id)

      const active = await readActiveHolds(payload, config, target, new Date())

      if (!holdFits({ holdID: hold.id, holds: active, inventory })) {
        await deleteHolds(payload, config, [hold.id])
        held.splice(held.indexOf(hold.id), 1)

        return {
          held,
          refusal: refusal({
            code: refusalCodes.OutOfStock,
            collection: target.collection,
            document: target.document,
            message: `${target.collection} ${target.document} was taken by another checkout while this one was in progress.`,
          }),
        }
      }
    }
  } catch (error) {
    await discardOwnHolds(payload, config, held)

    throw error
  }

  return { held, refusal: null }
}
