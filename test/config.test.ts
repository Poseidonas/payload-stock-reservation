import { describe, expect, it } from 'vitest'

import { resolveConfig } from '../src/config.js'

describe('resolveConfig', () => {
  it('fills in the documented defaults', () => {
    expect(resolveConfig()).toEqual({
      cartsSlug: 'carts',
      defaultCurrency: '',
      disabled: false,
      holdScanLimit: 500,
      holdsSlug: 'stock-holds',
      inventoryFieldName: 'inventory',
      productsSlug: 'products',
      refuseNegativeInventory: true,
      releaseEndpointPath: '/stock-reservation/release-expired',
      releaseSecret: '',
      sweepOnCheckout: true,
      ttlSeconds: 900,
      variantsSlug: 'variants',
    })
  })

  it('rejects a zero or negative ttl rather than applying it', () => {
    expect(resolveConfig({ ttlSeconds: 0 }).ttlSeconds).toBe(900)
    expect(resolveConfig({ ttlSeconds: -60 }).ttlSeconds).toBe(900)
  })

  it('truncates a fractional ttl instead of storing it', () => {
    expect(resolveConfig({ ttlSeconds: 90.9 }).ttlSeconds).toBe(90)
  })

  it('rejects a zero or negative hold scan limit', () => {
    expect(resolveConfig({ holdScanLimit: 0 }).holdScanLimit).toBe(500)
    expect(resolveConfig({ holdScanLimit: -1 }).holdScanLimit).toBe(500)
  })

  it('falls back when a slug is given as an empty string', () => {
    expect(resolveConfig({ cartsSlug: '', holdsSlug: '', variantsSlug: '' })).toMatchObject({
      cartsSlug: 'carts',
      holdsSlug: 'stock-holds',
      variantsSlug: 'variants',
    })
  })

  it('keeps custom slugs', () => {
    expect(
      resolveConfig({ holdsSlug: 'reservations', productsSlug: 'items' }),
    ).toMatchObject({ holdsSlug: 'reservations', productsSlug: 'items' })
  })

  it('normalises the default currency to trimmed upper case', () => {
    expect(resolveConfig({ defaultCurrency: ' eur ' }).defaultCurrency).toBe('EUR')
  })

  it('adds the leading slash to a release path that lacks one', () => {
    expect(resolveConfig({ releaseEndpointPath: 'holds/sweep' }).releaseEndpointPath).toBe(
      '/holds/sweep',
    )
  })

  it('keeps a release path that already has a leading slash', () => {
    expect(resolveConfig({ releaseEndpointPath: '/holds/sweep' }).releaseEndpointPath).toBe(
      '/holds/sweep',
    )
  })

  it('falls back to the default release path when given an empty string', () => {
    expect(resolveConfig({ releaseEndpointPath: '' }).releaseEndpointPath).toBe(
      '/stock-reservation/release-expired',
    )
  })

  it('treats disabled as true only when it is exactly true', () => {
    expect(resolveConfig({ disabled: true }).disabled).toBe(true)
    expect(resolveConfig({ disabled: false }).disabled).toBe(false)
    expect(resolveConfig({ disabled: 'yes' as unknown as boolean }).disabled).toBe(false)
  })

  it('keeps refuseNegativeInventory on unless it is switched off', () => {
    expect(resolveConfig({ refuseNegativeInventory: false }).refuseNegativeInventory).toBe(false)
    expect(
      resolveConfig({ refuseNegativeInventory: 'no' as unknown as boolean })
        .refuseNegativeInventory,
    ).toBe(true)
  })

  it('keeps sweepOnCheckout on unless it is switched off', () => {
    expect(resolveConfig({ sweepOnCheckout: false }).sweepOnCheckout).toBe(false)
  })

  it('keeps a release secret verbatim', () => {
    expect(resolveConfig({ releaseSecret: ' spaced ' }).releaseSecret).toBe(' spaced ')
  })

  it('keeps a custom inventory field name', () => {
    expect(resolveConfig({ inventoryFieldName: 'stock' }).inventoryFieldName).toBe('stock')
  })
})
