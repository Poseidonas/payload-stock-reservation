import type { Config, Endpoint, Payload } from 'payload'

import { describe, expect, it, vi } from 'vitest'

import { stockReservationPlugin } from '../src/index.js'

const noop: Endpoint['handler'] = () => Response.json({ message: 'original' })

const ecommerceEndpoints: Endpoint[] = [
  { handler: noop, method: 'post', path: '/payments/stripe/initiate' },
  { handler: noop, method: 'post', path: '/payments/stripe/confirm-order' },
  { handler: noop, method: 'post', path: '/payments/stripe/webhooks' },
]

const baseConfig = (overrides: Partial<Config> = {}): Config =>
  ({
    collections: [{ fields: [], slug: 'products' }],
    endpoints: ecommerceEndpoints,
    ...overrides,
  }) as Config

const endpointAt = (config: Config, path: string): Endpoint | undefined =>
  config.endpoints?.find((endpoint) => endpoint.path === path)

const logger = () => {
  const error = vi.fn()

  return { error, payload: { logger: { error } } as unknown as Payload }
}

describe('stockReservationPlugin, collections', () => {
  it('adds the holds collection', () => {
    const result = stockReservationPlugin()(baseConfig())

    expect(result.collections?.map((entry) => entry.slug)).toContain('stock-holds')
  })

  it('uses a custom holds slug', () => {
    const result = stockReservationPlugin({ holdsSlug: 'reservations' })(baseConfig())

    expect(result.collections?.map((entry) => entry.slug)).toContain('reservations')
  })

  it('leaves the collections that were already there untouched', () => {
    const result = stockReservationPlugin()(baseConfig())

    expect(result.collections?.[0]).toMatchObject({ slug: 'products' })
  })

  it('does not add the holds collection twice', () => {
    const once = stockReservationPlugin()(baseConfig())
    const twice = stockReservationPlugin()(once)

    expect(twice.collections?.filter((entry) => entry.slug === 'stock-holds')).toHaveLength(1)
  })

  it('works against a config that declares no collections', () => {
    const result = stockReservationPlugin()({ endpoints: ecommerceEndpoints } as Config)

    expect(result.collections?.map((entry) => entry.slug)).toEqual(['stock-holds'])
  })
})

describe('stockReservationPlugin, endpoints', () => {
  it('replaces the handler of the initiate endpoint', () => {
    const result = stockReservationPlugin()(baseConfig())

    expect(endpointAt(result, '/payments/stripe/initiate')?.handler).not.toBe(noop)
  })

  it('replaces the handler of the confirm endpoint', () => {
    const result = stockReservationPlugin()(baseConfig())

    expect(endpointAt(result, '/payments/stripe/confirm-order')?.handler).not.toBe(noop)
  })

  it('leaves the other endpoints of the payment adapter alone', () => {
    const result = stockReservationPlugin()(baseConfig())

    expect(endpointAt(result, '/payments/stripe/webhooks')?.handler).toBe(noop)
  })

  it('wraps whatever the payment adapter is called', () => {
    const result = stockReservationPlugin()(
      baseConfig({
        endpoints: [{ handler: noop, method: 'post', path: '/payments/some-adapter/initiate' }],
      }),
    )

    expect(endpointAt(result, '/payments/some-adapter/initiate')?.handler).not.toBe(noop)
  })

  it('ignores a matching path served over another method', () => {
    const result = stockReservationPlugin()(
      baseConfig({
        endpoints: [{ handler: noop, method: 'get', path: '/payments/stripe/initiate' }],
      }),
    )

    expect(endpointAt(result, '/payments/stripe/initiate')?.handler).toBe(noop)
  })

  it('keeps the method and path of the endpoints it wraps', () => {
    const result = stockReservationPlugin()(baseConfig())

    expect(endpointAt(result, '/payments/stripe/initiate')).toMatchObject({
      method: 'post',
      path: '/payments/stripe/initiate',
    })
  })

  it('adds the release endpoint at the documented path', () => {
    const result = stockReservationPlugin()(baseConfig())

    expect(endpointAt(result, '/stock-reservation/release-expired')).toMatchObject({ method: 'post' })
  })

  it('adds the release endpoint at a custom path', () => {
    const result = stockReservationPlugin({ releaseEndpointPath: '/cron/holds' })(baseConfig())

    expect(endpointAt(result, '/cron/holds')).toBeDefined()
  })

  it('adds the release endpoint even when disabled', () => {
    const result = stockReservationPlugin({ disabled: true })(baseConfig())

    expect(endpointAt(result, '/stock-reservation/release-expired')).toBeDefined()
  })
})

describe('stockReservationPlugin, when the checkout endpoints are missing', () => {
  it('says so on startup rather than doing nothing quietly', async () => {
    const { error, payload } = logger()
    const result = stockReservationPlugin()(baseConfig({ endpoints: [] }))

    await result.onInit?.(payload)

    expect(error).toHaveBeenCalledOnce()
    expect(String(error.mock.calls[0]?.[0])).toContain('payload-stock-reservation')
  })

  it('still runs the onInit the host had already declared', async () => {
    const existing = vi.fn()
    const { error, payload } = logger()
    const result = stockReservationPlugin()(baseConfig({ endpoints: [], onInit: existing }))

    await result.onInit?.(payload)

    expect(existing).toHaveBeenCalledOnce()
    expect(error).toHaveBeenCalledOnce()
  })

  it('says so when the release path is shadowed by a collection', async () => {
    const { error, payload } = logger()
    const result = stockReservationPlugin({ releaseEndpointPath: '/products/sweep' })(baseConfig())

    await result.onInit?.(payload)

    expect(error).toHaveBeenCalledOnce()
    expect(String(error.mock.calls[0]?.[0])).toContain('/products/sweep')
  })

  it('says so when the release path is shadowed by its own holds collection', async () => {
    const { error, payload } = logger()
    const result = stockReservationPlugin({ releaseEndpointPath: '/stock-holds/sweep' })(
      baseConfig(),
    )

    await result.onInit?.(payload)

    expect(error).toHaveBeenCalledOnce()
  })

  it('reports both problems at once', async () => {
    const { error, payload } = logger()
    const result = stockReservationPlugin({ releaseEndpointPath: '/products/sweep' })(
      baseConfig({ endpoints: [] }),
    )

    await result.onInit?.(payload)

    expect(error).toHaveBeenCalledTimes(2)
  })

  it('accepts the default release path against the default collections', () => {
    expect(stockReservationPlugin()(baseConfig()).onInit).toBeUndefined()
  })

  it('leaves onInit alone once it has something to wrap', () => {
    const existing = vi.fn()
    const result = stockReservationPlugin()(baseConfig({ onInit: existing }))

    expect(result.onInit).toBe(existing)
  })

  it('adds no onInit of its own when it has something to wrap', () => {
    const result = stockReservationPlugin()(baseConfig())

    expect(result.onInit).toBeUndefined()
  })
})
