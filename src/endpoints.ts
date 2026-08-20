import { timingSafeEqual } from 'node:crypto'
import type { Endpoint, PayloadHandler, PayloadRequest } from 'payload'

import { refusalResponse } from './errors.js'
import { deleteHolds, releaseCartHolds, releaseExpiredHolds } from './holds.js'
import type { CartLine } from './reserve.js'
import { reserveCart } from './reserve.js'
import { readBody, resolveCart } from './request.js'
import type { ResolvedConfig } from './types.js'

const initiatePath = /^\/payments\/[^/]+\/initiate$/
const confirmPath = /^\/payments\/[^/]+\/confirm-order$/

export const isInitiatePath = (path: string): boolean => initiatePath.test(path)
export const isConfirmPath = (path: string): boolean => confirmPath.test(path)

const discard = async (req: PayloadRequest, config: ResolvedConfig, ids: string[]): Promise<void> => {
  if (ids.length === 0) {
    return
  }

  try {
    await deleteHolds(req.payload, config, ids)
  } catch (error) {
    req.payload.logger.error({
      err: error,
      msg: 'payload-stock-reservation: could not discard stock holds after a failed checkout',
    })
  }
}

export const wrapInitiate =
  (config: ResolvedConfig, handler: PayloadHandler): PayloadHandler =>
  async (req) => {
    if (config.disabled) {
      return handler(req)
    }

    let held: string[] = []

    try {
      const data = await readBody(req)
      const cart = resolveCart(req, data)

      if (!cart) {
        return handler(req)
      }

      const doc = await req.payload.findByID({
        id: cart.id,
        collection: config.cartsSlug,
        depth: 0,
        disableErrors: true,
        overrideAccess: true,
      })

      const record = doc as null | Record<string, unknown>
      const items = record?.items

      if (!Array.isArray(items) || items.length === 0) {
        return handler(req)
      }

      const cartCurrency = record?.currency
      const currency =
        typeof cartCurrency === 'string' && cartCurrency
          ? cartCurrency.toUpperCase()
          : config.defaultCurrency

      const outcome = await reserveCart({
        cart: cart.key,
        config,
        currency,
        items: items as CartLine[],
        payload: req.payload,
      })

      held = outcome.held

      if (outcome.refusal) {
        await discard(req, config, held)

        return refusalResponse(outcome.refusal)
      }
    } catch (error) {
      req.payload.logger.error({
        err: error,
        msg: 'payload-stock-reservation: stock could not be validated or held, letting the checkout continue',
      })

      await discard(req, config, held)

      return handler(req)
    }

    try {
      const response = await handler(req)

      if (response.status >= 400) {
        await discard(req, config, held)
      }

      return response
    } catch (error) {
      await discard(req, config, held)

      throw error
    }
  }

export const wrapConfirm =
  (config: ResolvedConfig, handler: PayloadHandler): PayloadHandler =>
  async (req) => {
    if (config.disabled) {
      return handler(req)
    }

    let key: null | string = null

    try {
      const data = await readBody(req)

      key = resolveCart(req, data)?.key ?? null
    } catch (error) {
      req.payload.logger.error({
        err: error,
        msg: 'payload-stock-reservation: could not read the cart of a confirmed order',
      })
    }

    const response = await handler(req)

    if (key !== null && response.status < 400) {
      try {
        await releaseCartHolds(req.payload, config, key)
      } catch (error) {
        req.payload.logger.error({
          err: error,
          msg: 'payload-stock-reservation: could not release the holds of a confirmed order, they will expire on their own',
        })
      }
    }

    return response
  }

const secretMatches = (given: string, expected: string): boolean => {
  const left = Buffer.from(given)
  const right = Buffer.from(expected)

  return left.length === right.length && timingSafeEqual(left, right)
}

const authorised = (req: PayloadRequest, config: ResolvedConfig): boolean => {
  if (req.user) {
    return true
  }

  if (!config.releaseSecret) {
    return false
  }

  const header = req.headers?.get('authorization') ?? ''
  const prefix = 'Bearer '

  return header.startsWith(prefix) && secretMatches(header.slice(prefix.length), config.releaseSecret)
}

export const releaseEndpoint = (config: ResolvedConfig): Endpoint => ({
  handler: async (req) => {
    if (!authorised(req, config)) {
      return Response.json({ message: 'Not allowed to release stock holds.' }, { status: 401 })
    }

    try {
      const released = await releaseExpiredHolds(req.payload, config)

      return Response.json({ released })
    } catch (error) {
      req.payload.logger.error({
        err: error,
        msg: 'payload-stock-reservation: could not release expired stock holds',
      })

      return Response.json({ message: 'Could not release expired stock holds.' }, { status: 500 })
    }
  },
  method: 'post',
  path: config.releaseEndpointPath,
})
