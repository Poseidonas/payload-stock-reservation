import { describe, expect, it } from 'vitest'

import { resolveConfig } from '../src/config.js'
import type { CartLine } from '../src/reserve.js'
import { reserveCart, toCheckoutLines } from '../src/reserve.js'
import type { StockReservationConfig } from '../src/types.js'
import { createFake, hold } from './fake.js'
import type { Doc, FakeStore } from './fake.js'

const catalogue: FakeStore = {
  products: [{ id: 'p1', inventory: 10, priceInEUR: 500 }],
  variants: [{ id: 'v1', inventory: 2, priceInEUR: 1500 }],
}

const run = async (args: {
  currency?: string
  items: CartLine[]
  options?: StockReservationConfig
  store?: FakeStore
}) => {
  const fake = createFake(args.store ?? catalogue)
  const config = resolveConfig(args.options)

  const outcome = await reserveCart({
    cart: 'cart-1',
    config,
    currency: args.currency ?? 'EUR',
    items: args.items,
    payload: fake.payload,
  })

  return { fake, outcome }
}

const holds = (store: FakeStore): Doc[] => store['stock-holds'] ?? []

describe('toCheckoutLines', () => {
  const config = resolveConfig()

  it('sends a line with a variant to the variants collection', () => {
    expect(toCheckoutLines([{ product: 'p1', quantity: 2, variant: 'v1' }], config)).toEqual([
      { quantity: 2, target: { collection: 'variants', document: 'v1', id: 'v1' } },
    ])
  })

  it('sends a line without a variant to the products collection', () => {
    expect(toCheckoutLines([{ product: 'p1', quantity: 1 }], config)).toEqual([
      { quantity: 1, target: { collection: 'products', document: 'p1', id: 'p1' } },
    ])
  })

  it('reads the identifier out of a populated relationship', () => {
    expect(toCheckoutLines([{ product: { id: 7 }, quantity: 1 }], config)).toEqual([
      { quantity: 1, target: { collection: 'products', document: '7', id: 7 } },
    ])
  })

  it('keeps the integer identifiers PostgreSQL produces', () => {
    const lines = toCheckoutLines([{ product: 3, quantity: 1, variant: 9 }], config)

    expect(lines[0]?.target).toEqual({ collection: 'variants', document: '9', id: 9 })
  })

  it('skips a line that names neither a product nor a variant', () => {
    expect(toCheckoutLines([{ quantity: 3 }], config)).toEqual([])
  })

  it('treats a missing quantity as one', () => {
    expect(toCheckoutLines([{ product: 'p1' }], config)[0]?.quantity).toBe(1)
  })

  it('truncates a fractional quantity and refuses a negative one', () => {
    expect(toCheckoutLines([{ product: 'p1', quantity: 2.9 }], config)[0]?.quantity).toBe(2)
    expect(toCheckoutLines([{ product: 'p1', quantity: -4 }], config)[0]?.quantity).toBe(1)
  })

  it('honours custom collection slugs', () => {
    const custom = resolveConfig({ productsSlug: 'items', variantsSlug: 'skus' })

    expect(toCheckoutLines([{ product: 'p1' }, { product: 'p1', variant: 'v1' }], custom)).toEqual([
      { quantity: 1, target: { collection: 'items', document: 'p1', id: 'p1' } },
      { quantity: 1, target: { collection: 'skus', document: 'v1', id: 'v1' } },
    ])
  })
})

describe('reserveCart, variant stock', () => {
  it('refuses more of a variant than it has, which the official plugin never checks', async () => {
    const { fake, outcome } = await run({
      items: [{ product: 'p1', quantity: 5, variant: 'v1' }],
    })

    expect(outcome.refusal).toMatchObject({
      code: 'OutOfStock',
      collection: 'variants',
      document: 'v1',
      status: 400,
    })
    expect(holds(fake.store)).toHaveLength(0)
  })

  it('holds a variant quantity that fits', async () => {
    const { fake, outcome } = await run({
      items: [{ product: 'p1', quantity: 2, variant: 'v1' }],
    })

    expect(outcome.refusal).toBeNull()
    expect(outcome.held).toHaveLength(1)
    expect(holds(fake.store)[0]).toMatchObject({
      cart: 'cart-1',
      quantity: 2,
      stockCollection: 'variants',
      stockDocument: 'v1',
    })
  })

  it('still refuses a product line the way the official plugin does', async () => {
    const { outcome } = await run({ items: [{ product: 'p1', quantity: 11 }] })

    expect(outcome.refusal).toMatchObject({ code: 'OutOfStock', collection: 'products' })
  })

  it('gives the hold an expiry taken from the configured ttl', async () => {
    const before = Date.now()
    const { fake } = await run({
      items: [{ product: 'p1', quantity: 1, variant: 'v1' }],
      options: { ttlSeconds: 60 },
    })

    const expiresAt = Date.parse(String(holds(fake.store)[0]?.expiresAt))

    expect(expiresAt).toBeGreaterThanOrEqual(before + 60_000)
    expect(expiresAt).toBeLessThan(before + 65_000)
  })
})

describe('reserveCart, availability is stock minus holds', () => {
  it('refuses a quantity that raw stock allows but live holds do not', async () => {
    const { fake, outcome } = await run({
      items: [{ product: 'p1', quantity: 2, variant: 'v1' }],
      store: {
        ...catalogue,
        'stock-holds': [
          hold({ createdAt: '2020-01-01T00:00:00.000Z', id: 'other', quantity: 1 }),
        ],
      },
    })

    expect(outcome.refusal).toMatchObject({ code: 'OutOfStock' })
    expect(holds(fake.store).map((doc) => doc.id)).toEqual(['other'])
  })

  it('ignores holds that have already expired', async () => {
    const { outcome } = await run({
      items: [{ product: 'p1', quantity: 2, variant: 'v1' }],
      store: {
        ...catalogue,
        'stock-holds': [
          hold({ expiresAt: '2000-01-01T00:00:00.000Z', id: 'stale', quantity: 2 }),
        ],
      },
    })

    expect(outcome.refusal).toBeNull()
  })

  it('counts two lines of the same variant against one another', async () => {
    const { outcome } = await run({
      items: [
        { product: 'p1', quantity: 1, variant: 'v1' },
        { product: 'p1', quantity: 2, variant: 'v1' },
      ],
    })

    expect(outcome.refusal).toMatchObject({ code: 'OutOfStock' })
  })

  it('releases the holds a cart already had before measuring again', async () => {
    const { fake, outcome } = await run({
      items: [{ product: 'p1', quantity: 2, variant: 'v1' }],
      store: {
        ...catalogue,
        'stock-holds': [hold({ cart: 'cart-1', id: 'previous', quantity: 2 })],
      },
    })

    expect(outcome.refusal).toBeNull()
    expect(holds(fake.store).map((doc) => doc.id)).not.toContain('previous')
  })
})

describe('reserveCart, price', () => {
  it('refuses a variant with no price in the currency of the cart', async () => {
    const { outcome } = await run({
      items: [{ product: 'p1', quantity: 1, variant: 'v1' }],
      store: { ...catalogue, variants: [{ id: 'v1', inventory: 5 }] },
    })

    expect(outcome.refusal).toMatchObject({ code: 'MissingPrice', collection: 'variants' })
  })

  it('refuses a price of zero, as the official plugin does', async () => {
    const { outcome } = await run({
      items: [{ product: 'p1', quantity: 1, variant: 'v1' }],
      store: { ...catalogue, variants: [{ id: 'v1', inventory: 5, priceInEUR: 0 }] },
    })

    expect(outcome.refusal).toMatchObject({ code: 'MissingPrice' })
  })

  it('skips the price check when no currency is known', async () => {
    const { outcome } = await run({
      currency: '',
      items: [{ product: 'p1', quantity: 1, variant: 'v1' }],
      store: { ...catalogue, variants: [{ id: 'v1', inventory: 5 }] },
    })

    expect(outcome.refusal).toBeNull()
  })

  it('reads the price field of the currency it was given', async () => {
    const { outcome } = await run({
      currency: 'USD',
      items: [{ product: 'p1', quantity: 1, variant: 'v1' }],
    })

    expect(outcome.refusal).toMatchObject({ code: 'MissingPrice' })
  })
})

describe('reserveCart, stock that is not tracked or is broken', () => {
  it('leaves an item without an inventory value alone, as unlimited', async () => {
    const { fake, outcome } = await run({
      items: [{ product: 'p1', quantity: 999, variant: 'v1' }],
      store: { ...catalogue, variants: [{ id: 'v1', priceInEUR: 100 }] },
    })

    expect(outcome.refusal).toBeNull()
    expect(holds(fake.store)).toHaveLength(0)
  })

  it('refuses an item already recorded as oversold', async () => {
    const { outcome } = await run({
      items: [{ product: 'p1', quantity: 1, variant: 'v1' }],
      store: { ...catalogue, variants: [{ id: 'v1', inventory: -3, priceInEUR: 100 }] },
    })

    expect(outcome.refusal).toMatchObject({ code: 'NegativeInventory' })
  })

  it('falls back to the ordinary out of stock reason when that check is switched off', async () => {
    const { outcome } = await run({
      items: [{ product: 'p1', quantity: 1, variant: 'v1' }],
      options: { refuseNegativeInventory: false },
      store: { ...catalogue, variants: [{ id: 'v1', inventory: -3, priceInEUR: 100 }] },
    })

    expect(outcome.refusal).toMatchObject({ code: 'OutOfStock' })
  })

  it('refuses a line whose variant no longer exists', async () => {
    const { outcome } = await run({
      items: [{ product: 'p1', quantity: 1, variant: 'gone' }],
    })

    expect(outcome.refusal).toMatchObject({ code: 'NotFound', status: 404 })
  })
})

describe('reserveCart, a hold that loses the race', () => {
  const lastUnit: FakeStore = {
    ...catalogue,
    variants: [{ id: 'v1', inventory: 1, priceInEUR: 1500 }],
  }

  it('deletes its own hold and refuses when an older hold took the last unit', async () => {
    const { fake, outcome } = await run({
      items: [{ product: 'p1', quantity: 1, variant: 'v1' }],
      store: {
        ...lastUnit,
        'stock-holds': [
          hold({ createdAt: '2000-01-01T00:00:00.000Z', id: 'older', quantity: 1 }),
        ],
      },
    })

    expect(outcome.refusal).toMatchObject({ code: 'OutOfStock' })
    expect(outcome.held).toEqual([])
    expect(holds(fake.store).map((doc) => doc.id)).toEqual(['older'])
  })

  it('keeps the last unit when no other hold is in the way', async () => {
    const { fake, outcome } = await run({
      items: [{ product: 'p1', quantity: 1, variant: 'v1' }],
      store: lastUnit,
    })

    expect(outcome.refusal).toBeNull()
    expect(holds(fake.store)).toHaveLength(1)
  })

  it('drops the holds of earlier lines out of the outcome when a later line is refused', async () => {
    const { outcome } = await run({
      items: [
        { product: 'p1', quantity: 1 },
        { product: 'p1', quantity: 1, variant: 'v1' },
      ],
      store: {
        ...lastUnit,
        'stock-holds': [
          hold({ createdAt: '2000-01-01T00:00:00.000Z', id: 'older', quantity: 1 }),
        ],
      },
    })

    expect(outcome.refusal).toMatchObject({ code: 'OutOfStock', collection: 'variants' })
    expect(outcome.held).toHaveLength(1)
  })
})

describe('reserveCart, housekeeping', () => {
  it('sweeps the expired holds of the items it is about to check', async () => {
    const { fake } = await run({
      items: [{ product: 'p1', quantity: 1, variant: 'v1' }],
      store: {
        ...catalogue,
        'stock-holds': [hold({ expiresAt: '2000-01-01T00:00:00.000Z', id: 'stale' })],
      },
    })

    expect(holds(fake.store).map((doc) => doc.id)).not.toContain('stale')
  })

  it('leaves expired holds in place when sweeping is switched off', async () => {
    const { fake } = await run({
      items: [{ product: 'p1', quantity: 1, variant: 'v1' }],
      options: { sweepOnCheckout: false },
      store: {
        ...catalogue,
        'stock-holds': [hold({ expiresAt: '2000-01-01T00:00:00.000Z', id: 'stale' })],
      },
    })

    expect(holds(fake.store).map((doc) => doc.id)).toContain('stale')
  })

  it('leaves an expired hold of another item alone', async () => {
    const { fake } = await run({
      items: [{ product: 'p1', quantity: 1, variant: 'v1' }],
      store: {
        ...catalogue,
        'stock-holds': [
          hold({
            expiresAt: '2000-01-01T00:00:00.000Z',
            id: 'stale-elsewhere',
            stockDocument: 'v-other',
          }),
        ],
      },
    })

    expect(holds(fake.store).map((doc) => doc.id)).toContain('stale-elsewhere')
  })

  it('does nothing at all for an empty cart', async () => {
    const { fake, outcome } = await run({ items: [] })

    expect(outcome).toEqual({ held: [], refusal: null })
    expect(holds(fake.store)).toHaveLength(0)
  })
})
