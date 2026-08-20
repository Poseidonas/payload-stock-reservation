import type { PayloadRequest } from 'payload'

import { describe, expect, it } from 'vitest'

import { readBody, resolveCart } from '../src/request.js'
import { createFake, jsonRequest } from './fake.js'

const bare = (values: Record<string, unknown>): PayloadRequest =>
  values as unknown as PayloadRequest

describe('readBody', () => {
  it('returns the body Payload has already parsed', async () => {
    const req = bare({ data: { cartID: 'cart-1' } })

    expect(await readBody(req)).toEqual({ cartID: 'cart-1' })
  })

  it('parses a JSON body and leaves it readable for the wrapped handler', async () => {
    const fake = createFake()
    const req = jsonRequest(fake, { cartID: 'cart-1' })

    expect(await readBody(req)).toEqual({ cartID: 'cart-1' })
    expect(await req.json?.()).toEqual({ cartID: 'cart-1' })
    expect(await req.text?.()).toBe('{"cartID":"cart-1"}')
  })

  it('reads the same body twice without consuming it', async () => {
    const fake = createFake()
    const req = jsonRequest(fake, { cartID: 'cart-1' })

    await readBody(req)

    expect(await readBody(req)).toEqual({ cartID: 'cart-1' })
  })

  it('leaves a body that is not JSON alone', async () => {
    const req = bare({
      headers: new Headers({ 'content-type': 'multipart/form-data; boundary=x' }),
      text: () => Promise.resolve('irrelevant'),
    })

    expect(await readBody(req)).toBeUndefined()
  })

  it('returns nothing for an empty body', async () => {
    const req = bare({
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.resolve(''),
    })

    expect(await readBody(req)).toBeUndefined()
  })

  it('returns nothing when the request cannot produce text', async () => {
    const req = bare({ headers: new Headers({ 'content-type': 'application/json' }) })

    expect(await readBody(req)).toBeUndefined()
  })

  it('accepts a content type that carries a charset', async () => {
    const req = bare({
      headers: new Headers({ 'content-type': 'application/json; charset=utf-8' }),
      text: () => Promise.resolve('{"cartID":"cart-9"}'),
    })

    expect(await readBody(req)).toEqual({ cartID: 'cart-9' })
  })
})

describe('resolveCart', () => {
  it('takes the cart named in the body', () => {
    expect(resolveCart(bare({}), { cartID: 'cart-1' })).toEqual({ id: 'cart-1', key: 'cart-1' })
  })

  it('keeps an integer cart identifier as an integer for the lookup', () => {
    expect(resolveCart(bare({}), { cartID: 42 })).toEqual({ id: 42, key: '42' })
  })

  it('falls back to the cart of the signed in user', () => {
    const req = bare({ user: { cart: { docs: ['cart-7'] } } })

    expect(resolveCart(req, undefined)).toEqual({ id: 'cart-7', key: 'cart-7' })
  })

  it('reads the identifier out of a populated user cart', () => {
    const req = bare({ user: { cart: { docs: [{ id: 8 }] } } })

    expect(resolveCart(req, undefined)).toEqual({ id: 8, key: '8' })
  })

  it('prefers the cart in the body over the cart of the user', () => {
    const req = bare({ user: { cart: { docs: ['cart-7'] } } })

    expect(resolveCart(req, { cartID: 'cart-1' })?.key).toBe('cart-1')
  })

  it('returns nothing when no cart can be found', () => {
    expect(resolveCart(bare({}), {})).toBeNull()
    expect(resolveCart(bare({ user: { cart: { docs: [] } } }), {})).toBeNull()
  })

  it('ignores an empty cart identifier', () => {
    expect(resolveCart(bare({}), { cartID: '' })).toBeNull()
  })
})
