export type StockReservationConfig = {
  /**
   * Slug of the carts collection. Defaults to 'carts'.
   */
  cartsSlug?: string
  /**
   * Currency used for the price check when the cart carries none.
   * Left empty by default, in which case the price check is skipped
   * and only stock is validated.
   */
  defaultCurrency?: string
  /**
   * Disables validation and holding while leaving the holds collection
   * in place, so that an existing database keeps its shape.
   */
  disabled?: boolean
  /**
   * Highest number of holds read for one product or variant when deciding
   * whether a new hold fits. Defaults to 500.
   */
  holdScanLimit?: number
  /**
   * Slug of the collection that holds reserved stock.
   * Defaults to 'stock-holds'.
   */
  holdsSlug?: string
  /**
   * Name of the numeric field holding stock on products and variants.
   * Defaults to 'inventory', which is what the official plugin uses.
   */
  inventoryFieldName?: string
  /**
   * Slug of the products collection. Defaults to 'products'.
   */
  productsSlug?: string
  /**
   * Refuses an item whose recorded stock is already below zero, with the
   * reason 'NegativeInventory'. When false the negative value is carried
   * into the ordinary availability arithmetic instead, which refuses the
   * item with the reason 'OutOfStock'. Defaults to true.
   */
  refuseNegativeInventory?: boolean
  /**
   * Path of the endpoint that deletes expired holds, served under the Payload
   * API route. Its first segment must not be the slug of a collection, because
   * Payload resolves that segment to the collection and never reaches a root
   * endpoint. Defaults to '/stock-reservation/release-expired'.
   */
  releaseEndpointPath?: string
  /**
   * Shared secret accepted by the release endpoint as
   * `Authorization: Bearer <secret>`, for schedulers that have no Payload
   * session. Empty by default, in which case only a signed in user may
   * call the endpoint.
   */
  releaseSecret?: string
  /**
   * Deletes expired holds on the products and variants of the cart at the
   * start of every checkout, so the collection stays small without a
   * scheduler. Defaults to true.
   */
  sweepOnCheckout?: boolean
  /**
   * How long a hold survives, in seconds. Defaults to 900, fifteen minutes.
   */
  ttlSeconds?: number
  /**
   * Slug of the variants collection. Defaults to 'variants'.
   */
  variantsSlug?: string
}

export type ResolvedConfig = Required<StockReservationConfig>

/**
 * Machine readable reason returned as `cause.code` on a refusal.
 */
export type RefusalCode = 'MissingPrice' | 'NegativeInventory' | 'NotFound' | 'OutOfStock'

/**
 * One stock hold as it is stored in the holds collection.
 */
export type StockHold = {
  cart: string
  createdAt: string
  expiresAt: string
  id: string
  quantity: number
  stockCollection: string
  stockDocument: string
}
