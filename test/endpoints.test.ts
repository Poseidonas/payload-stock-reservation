import type { PayloadHandler } from 'payload'

import { describe, expect, it, vi } from 'vitest'

import { resolveConfig } from '../src/config.js'
import {
  isConfirmPath,
  isInitiatePath,
  releaseEndpoint,
  wrapConfirm,
  wrapInitiate,
} from '../src/endpoints.js'
import type { FakeStore } from './fake.js'
import { createFake, hold, jsonRequest } from './fake.js'

const catalogue: FakeStore = {
  carts: [{ id: 'cart-1', currency: 'EUR', items: [{ product: 'p1', quantity: 5, variant: 'v1' }] }],
  products: [{ id: 'p1', inventory: 10, priceInEUR: 500 }],
  variants: [{ id: 'v1', inventory: 2, priceInEUR: 1500 }],
}

const fitting: FakeStore = {
  ...catalogue,
  carts: [{ id: 'cart-1', currency: 'EUR', items: [{ product: 'p1', quantity: 2, variant: 'v1' }] }],
}

const ok: PayloadHandler = () => Response.json({ message: 'Payment initiated successfully' })

describe('path matching', () => {
  it('recognises the initiate endpoint of any adapter', () => {
    expect(isInitiatePath('/payments/stripe/initiate')).toBe(true)
    expect(isInitiatePath('/payments/adyen/initiate')).toBe(true)
  })

  it('recognises the confirm endpoint of any adapter', () => {
    expect(isConfirmPath('/payments/stripe/confirm-order')).toBe(true)
  })

  it('does not match anything else', () => {
    expect(isInitiatePath('/payments/stripe/webhooks')).toBe(false)
    expect(isInitiatePath('/payments/stripe/initiate/extra')).toBe(false)
    expect(isInitiatePath('/initiate')).toBe(false)
    expect(isConfirmPath('/payments/stripe/initiate')).toBe(false)
  })
})

describe('wrapInitiate', () => {
  it('refuses a variant the cart cannot have, before the payment provider is reached', async () => {
    const fake = createFake(catalogue)
    const inner = vi.fn(ok)
    const response = await wrapInitiate(resolveConfig(), inner)(
      jsonRequest(fake, { cartID: 'cart-1' }),
    )

    const body = (await response.json()) as { cause: { code: string }; message: string }

    expect(response.status).toBe(400)
    expect(body.cause.code).toBe('OutOfStock')
    expect(typeof body.message).toBe('string')
    expect(inner).not.toHaveBeenCalled()
  })

  it('holds the stock and lets a valid checkout through', async () => {
    const fake = createFake(fitting)
    const inner = vi.fn(ok)
    const response = await wrapInitiate(resolveConfig(), inner)(
      jsonRequest(fake, { cartID: 'cart-1' }),
    )

    expect(response.status).toBe(200)
    expect(inner).toHaveBeenCalledOnce()
    expect(fake.store['stock-holds']).toHaveLength(1)
  })

  it('leaves no hold behind when it refuses', async () => {
    const fake = createFake(catalogue)

    await wrapInitiate(resolveConfig(), vi.fn(ok))(jsonRequest(fake, { cartID: 'cart-1' }))

    expect(fake.store['stock-holds'] ?? []).toHaveLength(0)
  })

  it('gives the stock back when the payment provider refuses', async () => {
    const fake = createFake(fitting)
    const failing: PayloadHandler = () => Response.json({ message: 'nope' }, { status: 500 })

    await wrapInitiate(resolveConfig(), failing)(jsonRequest(fake, { cartID: 'cart-1' }))

    expect(fake.store['stock-holds'] ?? []).toHaveLength(0)
  })

  it('gives the stock back when the payment provider throws', async () => {
    const fake = createFake(fitting)
    const throwing: PayloadHandler = () => {
      throw new Error('provider down')
    }

    await expect(
      wrapInitiate(resolveConfig(), throwing)(jsonRequest(fake, { cartID: 'cart-1' })),
    ).rejects.toThrow('provider down')

    expect(fake.store['stock-holds'] ?? []).toHaveLength(0)
  })

  it('does nothing at all when the plugin is disabled', async () => {
    const fake = createFake(catalogue)
    const inner = vi.fn(ok)

    const response = await wrapInitiate(resolveConfig({ disabled: true }), inner)(
      jsonRequest(fake, { cartID: 'cart-1' }),
    )

    expect(response.status).toBe(200)
    expect(inner).toHaveBeenCalledOnce()
  })

  it('lets the checkout through when the cart cannot be identified', async () => {
    const fake = createFake(catalogue)
    const inner = vi.fn(ok)

    await wrapInitiate(resolveConfig(), inner)(jsonRequest(fake, {}))

    expect(inner).toHaveBeenCalledOnce()
  })

  it('lets the checkout through when the cart is empty', async () => {
    const fake = createFake({ ...catalogue, carts: [{ id: 'cart-1', currency: 'EUR', items: [] }] })
    const inner = vi.fn(ok)

    await wrapInitiate(resolveConfig(), inner)(jsonRequest(fake, { cartID: 'cart-1' }))

    expect(inner).toHaveBeenCalledOnce()
  })

  it('logs and lets the sale through when it cannot do its job', async () => {
    const fake = createFake(fitting)

    Object.assign(fake.payload, {
      find: () => Promise.reject(new Error('database unreachable')),
    })

    const inner = vi.fn(ok)
    const response = await wrapInitiate(resolveConfig(), inner)(
      jsonRequest(fake, { cartID: 'cart-1' }),
    )

    expect(response.status).toBe(200)
    expect(inner).toHaveBeenCalledOnce()
    expect(fake.errors).toHaveLength(1)
  })

  it('leaves no half written hold behind when it gives up', async () => {
    const fake = createFake(fitting)

    Object.assign(fake.payload, {
      find: () => Promise.reject(new Error('database unreachable')),
    })

    await wrapInitiate(resolveConfig(), vi.fn(ok))(jsonRequest(fake, { cartID: 'cart-1' }))

    expect(fake.store['stock-holds'] ?? []).toHaveLength(0)
  })

  it('falls back to the configured currency when the cart carries none', async () => {
    const fake = createFake({
      ...fitting,
      carts: [{ id: 'cart-1', items: [{ product: 'p1', quantity: 1, variant: 'v1' }] }],
    })

    const response = await wrapInitiate(resolveConfig({ defaultCurrency: 'usd' }), vi.fn(ok))(
      jsonRequest(fake, { cartID: 'cart-1' }),
    )

    const body = (await response.json()) as { cause: { code: string } }

    expect(response.status).toBe(400)
    expect(body.cause.code).toBe('MissingPrice')
  })
})

describe('wrapConfirm', () => {
  it('releases the holds of the cart once the order is confirmed', async () => {
    const fake = createFake({
      ...fitting,
      'stock-holds': [hold({ cart: 'cart-1', id: 'h1' }), hold({ cart: 'cart-2', id: 'h2' })],
    })

    const response = await wrapConfirm(resolveConfig(), ok)(jsonRequest(fake, { cartID: 'cart-1' }))

    expect(response.status).toBe(200)
    expect(fake.store['stock-holds']?.map((doc) => doc.id)).toEqual(['h2'])
  })

  it('keeps the holds when confirmation fails, so the shopper can try again', async () => {
    const fake = createFake({
      ...fitting,
      'stock-holds': [hold({ cart: 'cart-1', id: 'h1' })],
    })

    const failing: PayloadHandler = () => Response.json({ message: 'nope' }, { status: 500 })

    await wrapConfirm(resolveConfig(), failing)(jsonRequest(fake, { cartID: 'cart-1' }))

    expect(fake.store['stock-holds']?.map((doc) => doc.id)).toEqual(['h1'])
  })

  it('does nothing at all when the plugin is disabled', async () => {
    const fake = createFake({
      ...fitting,
      'stock-holds': [hold({ cart: 'cart-1', id: 'h1' })],
    })

    await wrapConfirm(resolveConfig({ disabled: true }), ok)(
      jsonRequest(fake, { cartID: 'cart-1' }),
    )

    expect(fake.store['stock-holds']).toHaveLength(1)
  })

  it('logs and returns the order when the holds cannot be released', async () => {
    const fake = createFake(fitting)

    Object.assign(fake.payload, {
      delete: () => Promise.reject(new Error('database unreachable')),
    })

    const response = await wrapConfirm(resolveConfig(), ok)(jsonRequest(fake, { cartID: 'cart-1' }))

    expect(response.status).toBe(200)
    expect(fake.errors).toHaveLength(1)
  })
})

describe('releaseEndpoint', () => {
  const expired = (): FakeStore => ({
    'stock-holds': [
      hold({ expiresAt: '2000-01-01T00:00:00.000Z', id: 'stale' }),
      hold({ id: 'live' }),
    ],
  })

  it('refuses an anonymous caller when no secret is configured', async () => {
    const fake = createFake(expired())
    const response = await releaseEndpoint(resolveConfig()).handler(jsonRequest(fake, {}))

    expect(response.status).toBe(401)
    expect(fake.store['stock-holds']).toHaveLength(2)
  })

  it('accepts a signed in user', async () => {
    const fake = createFake(expired())
    const response = await releaseEndpoint(resolveConfig()).handler(
      jsonRequest(fake, {}, { id: 'u1' }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ released: 1 })
  })

  it('accepts the configured secret as a bearer token', async () => {
    const fake = createFake(expired())
    const req = jsonRequest(fake, {})

    req.headers.set('authorization', 'Bearer s3cret')

    const response = await releaseEndpoint(resolveConfig({ releaseSecret: 's3cret' })).handler(req)

    expect(response.status).toBe(200)
    expect(fake.store['stock-holds']?.map((doc) => doc.id)).toEqual(['live'])
  })

  it('refuses a wrong secret', async () => {
    const fake = createFake(expired())
    const req = jsonRequest(fake, {})

    req.headers.set('authorization', 'Bearer wrong')

    const response = await releaseEndpoint(resolveConfig({ releaseSecret: 's3cret' })).handler(req)

    expect(response.status).toBe(401)
  })

  it('refuses a secret of the wrong length without comparing it', async () => {
    const fake = createFake(expired())
    const req = jsonRequest(fake, {})

    req.headers.set('authorization', 'Bearer s3cret-and-more')

    const response = await releaseEndpoint(resolveConfig({ releaseSecret: 's3cret' })).handler(req)

    expect(response.status).toBe(401)
  })

  it('refuses a request that carries no authorization header', async () => {
    const fake = createFake(expired())
    const response = await releaseEndpoint(resolveConfig({ releaseSecret: 's3cret' })).handler(
      jsonRequest(fake, {}),
    )

    expect(response.status).toBe(401)
  })

  it('reports a failure rather than pretending it swept', async () => {
    const fake = createFake(expired())

    Object.assign(fake.payload, {
      delete: () => Promise.reject(new Error('database unreachable')),
    })

    const response = await releaseEndpoint(resolveConfig()).handler(
      jsonRequest(fake, {}, { id: 'u1' }),
    )

    expect(response.status).toBe(500)
    expect(fake.errors).toHaveLength(1)
  })

  it('sits at the configured path', () => {
    expect(releaseEndpoint(resolveConfig({ releaseEndpointPath: 'cron/sweep' }))).toMatchObject({
      method: 'post',
      path: '/cron/sweep',
    })
  })
})
