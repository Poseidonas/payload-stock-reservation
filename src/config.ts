import type { ResolvedConfig, StockReservationConfig } from './types.js'

const positiveInteger = (value: unknown, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }

  const rounded = Math.trunc(value)

  return rounded > 0 ? rounded : fallback
}

const text = (value: unknown, fallback: string): string =>
  typeof value === 'string' ? value : fallback

const flag = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback

const path = (value: unknown, fallback: string): string => {
  const given = text(value, fallback) || fallback

  return given.startsWith('/') ? given : `/${given}`
}

export const resolveConfig = (incoming: StockReservationConfig = {}): ResolvedConfig => ({
  cartsSlug: text(incoming.cartsSlug, 'carts') || 'carts',
  defaultCurrency: text(incoming.defaultCurrency, '').trim().toUpperCase(),
  disabled: incoming.disabled === true,
  holdScanLimit: positiveInteger(incoming.holdScanLimit, 500),
  holdsSlug: text(incoming.holdsSlug, 'stock-holds') || 'stock-holds',
  inventoryFieldName: text(incoming.inventoryFieldName, 'inventory') || 'inventory',
  productsSlug: text(incoming.productsSlug, 'products') || 'products',
  refuseNegativeInventory: flag(incoming.refuseNegativeInventory, true),
  releaseEndpointPath: path(incoming.releaseEndpointPath, '/stock-reservation/release-expired'),
  releaseSecret: text(incoming.releaseSecret, ''),
  sweepOnCheckout: flag(incoming.sweepOnCheckout, true),
  ttlSeconds: positiveInteger(incoming.ttlSeconds, 900),
  variantsSlug: text(incoming.variantsSlug, 'variants') || 'variants',
})
