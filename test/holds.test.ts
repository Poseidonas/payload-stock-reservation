import type { Field } from 'payload'

import { describe, expect, it } from 'vitest'

import { resolveConfig } from '../src/config.js'
import { holdsCollection, releaseExpiredHolds, toHold } from '../src/holds.js'
import { createFake, hold } from './fake.js'

const named = (fields: Field[]): Record<string, Field> =>
  Object.fromEntries(
    fields.flatMap((field) => ('name' in field && field.name ? [[field.name, field]] : [])),
  )

describe('holdsCollection', () => {
  it('takes its slug from the configuration', () => {
    expect(holdsCollection(resolveConfig()).slug).toBe('stock-holds')
    expect(holdsCollection(resolveConfig({ holdsSlug: 'reservations' })).slug).toBe('reservations')
  })

  it('is closed to the API in all four directions', () => {
    const access = holdsCollection(resolveConfig()).access ?? {}

    expect(access.create?.({} as never)).toBe(false)
    expect(access.delete?.({} as never)).toBe(false)
    expect(access.read?.({} as never)).toBe(false)
    expect(access.update?.({} as never)).toBe(false)
  })

  it('is hidden from the admin panel', () => {
    expect(holdsCollection(resolveConfig()).admin?.hidden).toBe(true)
  })

  it('carries exactly the five fields a hold needs', () => {
    const fields = named(holdsCollection(resolveConfig()).fields)

    expect(Object.keys(fields).sort()).toEqual([
      'cart',
      'expiresAt',
      'quantity',
      'stockCollection',
      'stockDocument',
    ])
  })

  it('indexes everything it queries on', () => {
    const fields = named(holdsCollection(resolveConfig()).fields)

    for (const name of ['cart', 'expiresAt', 'stockCollection', 'stockDocument']) {
      expect(fields[name]).toMatchObject({ index: true, required: true })
    }
  })

  it('refuses a hold for less than one unit', () => {
    const fields = named(holdsCollection(resolveConfig()).fields)

    expect(fields.quantity).toMatchObject({ min: 1, required: true, type: 'number' })
  })
})

describe('toHold', () => {
  it('turns a stored document into a hold', () => {
    expect(
      toHold({
        cart: 'cart-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2026-01-01T00:15:00.000Z',
        id: 'h1',
        quantity: 2,
        stockCollection: 'variants',
        stockDocument: 'v1',
      }),
    ).toEqual({
      cart: 'cart-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-01T00:15:00.000Z',
      id: 'h1',
      quantity: 2,
      stockCollection: 'variants',
      stockDocument: 'v1',
    })
  })

  it('accepts dates that come back as Date objects', () => {
    const result = toHold({
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      expiresAt: new Date('2026-01-01T00:15:00.000Z'),
      id: 'h1',
      quantity: 1,
    })

    expect(result?.createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(result?.expiresAt).toBe('2026-01-01T00:15:00.000Z')
  })

  it('accepts the integer identifiers PostgreSQL produces', () => {
    expect(toHold({ id: 41, quantity: 1 })?.id).toBe('41')
  })

  it('rejects anything that is not a document', () => {
    expect(toHold(null)).toBeNull()
    expect(toHold('h1')).toBeNull()
  })

  it('rejects a document with no identifier', () => {
    expect(toHold({ quantity: 1 })).toBeNull()
  })

  it('treats a missing quantity as zero rather than guessing', () => {
    expect(toHold({ id: 'h1' })?.quantity).toBe(0)
  })
})

describe('releaseExpiredHolds', () => {
  it('deletes the holds whose time has run out and keeps the rest', async () => {
    const fake = createFake({
      'stock-holds': [
        hold({ expiresAt: '2000-01-01T00:00:00.000Z', id: 'expired-1' }),
        hold({ expiresAt: '2000-01-01T00:00:00.000Z', id: 'expired-2' }),
        hold({ expiresAt: '2100-01-01T00:00:00.000Z', id: 'live' }),
      ],
    })

    const released = await releaseExpiredHolds(fake.payload)

    expect(released).toBe(2)
    expect(fake.store['stock-holds']?.map((doc) => doc.id)).toEqual(['live'])
  })

  it('reports zero when nothing has expired', async () => {
    const fake = createFake({
      'stock-holds': [hold({ expiresAt: '2100-01-01T00:00:00.000Z', id: 'live' })],
    })

    expect(await releaseExpiredHolds(fake.payload)).toBe(0)
  })

  it('works against a custom holds collection', async () => {
    const fake = createFake({
      reservations: [hold({ expiresAt: '2000-01-01T00:00:00.000Z', id: 'expired' })],
    })

    expect(await releaseExpiredHolds(fake.payload, { holdsSlug: 'reservations' })).toBe(1)
  })
})
