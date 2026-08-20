# payload-stock-reservation

[![npm](https://img.shields.io/npm/v/payload-stock-reservation?style=flat-square&color=0F766E)](https://www.npmjs.com/package/payload-stock-reservation) ![node](https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square) ![license](https://img.shields.io/badge/license-MIT-6C757D?style=flat-square) ![payload](https://img.shields.io/badge/Payload-3.88+-0a0c0b?style=flat-square)

Validates the stock and the price of a variant before a Payload checkout reaches the payment provider, which `@payloadcms/plugin-ecommerce` never does, and holds what it validated until the payment settles or the hold expires.

- Extends `@payloadcms/plugin-ecommerce`, wrapping its checkout endpoints instead of replacing them
- Availability means recorded stock minus live holds, not raw stock
- No runtime dependencies
- No admin components, so it survives minor releases

## Install

Requires **Payload 3.88 or newer** and **`@payloadcms/plugin-ecommerce` 3.88 or newer**. Verified against Payload 3.88.0 with the official plugin installed.

```bash
pnpm add payload-stock-reservation
```

```ts
import { ecommercePlugin } from '@payloadcms/plugin-ecommerce'
import { stockReservationPlugin } from 'payload-stock-reservation'

export default buildConfig({
  plugins: [
    ecommercePlugin({ ... }),
    stockReservationPlugin({
      ttlSeconds: 900,
    }),
  ],
})
```

`stockReservationPlugin` must come after `ecommercePlugin`, because it wraps the endpoints that plugin registers. If it comes first there is nothing to wrap, and it says so in the server log on startup rather than staying quiet.

## What was measured

Read in the published `@payloadcms/plugin-ecommerce@3.88.0`, in the original TypeScript carried by its source maps.

### Variant stock and price are never validated

In `src/endpoints/initiatePayment.ts` the variant check sits inside a branch that requires the item to have no variant:

```
201   if (item.product && !item.variant) {
253     if (item.variant) {
310     }
311   }
```

The inner condition can never be true. Reproduced on a live Payload 3.88 install: a product with inventory 2 and no variant is refused with HTTP 400 and `cause.code: OutOfStock`, while the same quantity of a variant with inventory 2 passes validation completely and reaches the payment provider.

`confirmOrder` then decrements that variant correctly, with `payload.db.updateOne` and `$inc`, so the stock goes negative. In the same handler `productsValidation` is destructured out of the arguments and never called.

What the official checkout actually checks, per cart line:

| Cart line | Price checked | Stock checked | Stock decremented after payment |
| --- | --- | --- | --- |
| product, no variant | yes | yes | yes |
| product with a variant | no | no | yes |

### Stock is validated but never held

Availability is read in `initiatePayment` and the decrement happens in `confirmOrder`. Nothing is written between the two, so two shoppers can both pass validation holding the same last unit.

### Where the check has to go

Three interception points were read before one was chosen:

| Point | Why it was rejected or chosen |
| --- | --- |
| `products.validation`, the official override | Rejected. For a line with a variant the loop never reaches the call, so the override is never invoked |
| A hook on the transactions collection | Rejected. The Stripe adapter creates the payment intent first and the transaction record second, so a hook there fires after the provider has been contacted |
| The `post /payments/:adapter/initiate` endpoint | Chosen. It is a root endpoint on the config, it runs before any adapter code, and wrapping it leaves the original handler in place |

### How a hold decides a race

Every Payload request runs in its own transaction, so a hold that is written inside the request transaction is invisible to a competing request until commit. Holds are therefore written outside it, which makes them visible immediately and carries the connection cost described under Honest limits.

A write alone still cannot serialise two checkouts, so the hold is written first and judged afterwards. All live holds on the same product or variant are read back, ranked oldest first, and their quantities accumulated. A hold keeps its stock only if the running total up to and including it fits inside the recorded stock. Of two checkouts racing for the last unit, the older keeps it and the newer deletes its own hold and is refused. Ties on the creation time are broken on the identifier, so the ranking is a total order and the two racers always agree on who won.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `cartsSlug` | `'carts'` | Slug of the carts collection |
| `defaultCurrency` | `''` | Currency for the price check when the cart carries none. Empty means the price check is skipped and only stock is validated |
| `disabled` | `false` | Stops validating and holding but keeps the collection, so the database keeps its shape |
| `holdScanLimit` | `500` | Highest number of holds read for one item when ranking a new hold |
| `holdsSlug` | `'stock-holds'` | Collection holding reserved stock |
| `inventoryFieldName` | `'inventory'` | Numeric field holding stock on products and variants |
| `productsSlug` | `'products'` | Slug of the products collection |
| `refuseNegativeInventory` | `true` | Refuses an item already recorded below zero with the reason `NegativeInventory` |
| `releaseEndpointPath` | `'/stock-reservation/release-expired'` | Path of the endpoint that deletes expired holds |
| `releaseSecret` | `''` | Secret accepted by that endpoint as `Authorization: Bearer <secret>`. Empty means only a signed in user may call it |
| `sweepOnCheckout` | `true` | Deletes the expired holds of the items in the cart at the start of every checkout |
| `ttlSeconds` | `900` | How long a hold survives, in seconds |
| `variantsSlug` | `'variants'` | Slug of the variants collection |

A value that cannot be used is replaced by its default rather than being applied. A `ttlSeconds` of `0` becomes `900`, `90.9` becomes `90`, and a slug given as an empty string becomes its default. A `releaseEndpointPath` without a leading slash gains one.

## What it adds to your database

| Collection | Field | Type | Notes |
| --- | --- | --- | --- |
| `stock-holds` | `cart` | text | indexed. The cart that owns the hold |
| `stock-holds` | `stockCollection` | text | indexed. `products` or `variants` |
| `stock-holds` | `stockDocument` | text | indexed. Identifier of the held product or variant |
| `stock-holds` | `quantity` | number | minimum 1 |
| `stock-holds` | `expiresAt` | date | indexed |

Nothing is added to your products, variants, carts or orders. The holds collection is closed to create, read, update and delete through the API and hidden in the admin panel. It is written only by the plugin.

## What it adds to your API

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/payments/:adapter/initiate` | post | Wrapped. Validates and holds, then calls the original handler |
| `/api/payments/:adapter/confirm-order` | post | Wrapped. Calls the original handler, then releases that cart's holds |
| `/api/stock-reservation/release-expired` | post | Added. Deletes expired holds and returns `{ "released": n }` |

A refused line returns HTTP 400 with a readable sentence and a machine readable reason:

```json
{
  "message": "Only 2 left of variants 41.",
  "cause": { "code": "OutOfStock", "collection": "variants", "document": "41" }
}
```

The codes are `OutOfStock`, `MissingPrice`, `NegativeInventory` and `NotFound`, exported as `refusalCodes`.

### Releasing expired holds

Expired holds never count towards availability, so nothing breaks if they are left in place. Deleting them only keeps the collection small, and there are three ways to do it, none of which needs a scheduler in your dependencies:

1. Leave `sweepOnCheckout` on. Every checkout deletes the expired holds of the items in its own cart.
2. Point your existing scheduler at the endpoint.

   ```bash
   curl -X POST https://example.com/api/stock-reservation/release-expired \
     -H "Authorization: Bearer $STOCK_RELEASE_SECRET"
   ```

3. Call it yourself, from a route handler or a script.

   ```ts
   import { releaseExpiredHolds } from 'payload-stock-reservation'

   const released = await releaseExpiredHolds(payload)
   ```

### Showing real availability

```ts
import { availableStock } from 'payload-stock-reservation'

const left = await availableStock(payload, { collection: 'variants', document: variantID })
```

It returns the recorded stock minus every live hold, or `null` when the item does not exist or does not track stock.

## Honest limits

**PostgreSQL needs a large enough connection pool.** A hold is written outside the request transaction, so that a competing checkout can see it. That opens a second connection while the request holds the first. The same mechanism was measured for `payload-order-numbers` on a live install: with the `pg` default pool of 10, ten simultaneous checkouts succeed and fifteen do not. Set the pool to at least twice the number of checkouts you expect in the same instant.

```ts
postgresAdapter({
  pool: { connectionString: process.env.DATABASE_URI, max: 60 },
})
```

MongoDB is not affected and needs no change.

**A hold is written before it is judged.** The hold has to exist before it can be ranked against the others, and the cart is read with access checks overridden so that guest carts behave the same way. A checkout that is then refused, whether by this package or by the original handler, deletes its own holds before returning, so nothing is left behind, but the write happens.

**It guards the checkout endpoints, nothing else.** An order written straight through the local API, the admin panel or a payment webhook does not pass through this package and is not validated or held.

**The decrement still belongs to the official plugin.** This package stops a sale that cannot be fulfilled from starting; it does not change how `confirmOrder` decrements stock afterwards. Stock that is already negative stays negative until you correct it.

**Both settings of `refuseNegativeInventory` refuse the sale.** The option changes the reason, not the outcome: `NegativeInventory` when it is on, `OutOfStock` when it is off. It exists so a storefront can tell an oversold record apart from an ordinary sell out.

**An item with no stock value is unlimited and is never held.** That is what the official plugin does with an empty inventory field, and this package does not change it.

**A price of zero is refused as a missing price.** That is also what the official plugin does. Free items cannot go through this checkout, with or without this package.

**Holds are deleted, not archived.** There is no history of who held what. If you need an audit trail, that is a different guarantee and belongs in a different package.

**Above `holdScanLimit` holds on one item the ranking window truncates.** With more than 500 live holds on a single product or variant, the ranking reads the oldest 500 and a hold outside that window is refused rather than mis-sold.

**The release endpoint path must not start with a collection slug.** Payload resolves the first path segment to a collection before it looks at root endpoints, so `/stock-holds/...` would never reach the handler. The default avoids this, and a path that would be shadowed is reported in the server log on startup.

**If the package cannot do its job, the sale goes through.** A database error while validating or holding is logged as an error and the checkout is handed to the original handler unchanged, leaving you exactly where you were without this package. Only a real refusal, one this package decided on, stops a checkout. Losing a sale to a broken sweep is worse than the oversell it was meant to prevent.

## License

MIT. Copyright George Vasiliades, https://github.com/Poseidonas
