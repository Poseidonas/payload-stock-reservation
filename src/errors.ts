import type { RefusalCode } from './types.js'

/**
 * Reasons a checkout line can be refused, returned as `cause.code` on the
 * 400 response so a storefront can branch without parsing prose.
 */
export const refusalCodes = {
  MissingPrice: 'MissingPrice',
  NegativeInventory: 'NegativeInventory',
  NotFound: 'NotFound',
  OutOfStock: 'OutOfStock',
} as const satisfies Record<RefusalCode, RefusalCode>

/**
 * A refused checkout line, carrying a sentence for the shopper and a code
 * for the storefront.
 */
export type Refusal = {
  code: RefusalCode
  collection: string
  document: string
  message: string
  status: number
}

export const refusal = (args: {
  code: RefusalCode
  collection: string
  document: string
  message: string
  status?: number
}): Refusal => ({
  code: args.code,
  collection: args.collection,
  document: args.document,
  message: args.message,
  status: args.status ?? 400,
})

export const refusalResponse = (value: Refusal): Response =>
  Response.json(
    {
      cause: { code: value.code, collection: value.collection, document: value.document },
      message: value.message,
    },
    { status: value.status },
  )
